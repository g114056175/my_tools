#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.VIDEOSPEED_PLAYWRIGHT?.trim();
const { chromium } = playwrightPath ? require(path.resolve(playwrightPath)) : require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extension = path.join(root, 'extension');
const fixturePath = path.join(root, 'tests/fixtures/tiny.webm');
const qaDirectory = path.join(root, 'work/qa-082-popup');
const runTag = process.env.VIDEOSPEED_POPUP_RUN_ID?.trim() || '';
if (runTag && !/^[a-zA-Z0-9_-]+$/.test(runTag)) throw new Error('Invalid VIDEOSPEED_POPUP_RUN_ID');
const output = runTag ? path.join(qaDirectory, runTag) : qaDirectory;
const reportName = path.basename(process.env.VIDEOSPEED_POPUP_RESULTS_NAME?.trim() || 'results.json');
const reportPath = path.join(qaDirectory, reportName);
const expectedVersion = process.env.VIDEOSPEED_POPUP_EXPECTED_VERSION?.trim() || null;
const expectedHash = process.env.VIDEOSPEED_POPUP_EXPECTED_RUNTIME_SHA256?.trim() || null;
const assertHealthy = process.env.VIDEOSPEED_POPUP_ASSERT_HEALTHY !== '0';
const requestedPopupHoldMs = Math.max(0, Number(process.env.VIDEOSPEED_POPUP_HOLD_MS) || 0);
const qaSite = (process.env.VIDEOSPEED_POPUP_SITE?.trim() || 'bilibili').toLowerCase();
if (!['bilibili', 'youtube'].includes(qaSite)) throw new Error('VIDEOSPEED_POPUP_SITE must be bilibili or youtube');
const siteHostname = qaSite === 'youtube' ? 'www.youtube.com' : 'www.bilibili.com';
const fixtureBaseUrl = qaSite === 'youtube' ? 'https://www.youtube.com/watch?v=QA082&fixture=local' :
  'https://www.bilibili.com/video/BV1QA082?fixture=local';
const mainTitle = qaSite === 'youtube' ? 'QA 主片：YouTube html5 player' : 'QA 主片：Bilibili bpx-player';
const childTitle = 'QA 子 frame 影片';
const previewTitle = 'QA 側欄預覽';
const settings = {
  enabled: true,
  preferredRate: 1.25,
  defaultMode: 'off',
  customRate: 1.25,
  qualityEnabled: false,
  preferredQuality: 1080,
  steps: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [],
  siteModes: {},
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, host, worker, cdp, temporaryRoot, extensionId, media;
let nestedCdpMessageId = 0;
const popupGetStateProbed = new Set();
const report = {
  startedAt: new Date().toISOString(),
  result: 'INCOMPLETE',
  baseline: { expectedVersion, expectedHash, version: null, runtimeSha256: null, matched: false },
  browser: { mode: 'headed', name: null, isolatedTemporaryProfile: true, executablePath: null, version: null },
  fixture: { host: siteHostname, site: qaSite, media: 'tests/fixtures/tiny.webm', nativeVideoControls: true, externalRequestsBlocked: true },
  validation: { mode: assertHealthy ? 'candidate-assertions' : 'observe', passed: null, checks: [] },
  checkpoints: [],
  timepointTrials: [],
  focusTransition: null,
  reinjection: null,
  workerRestart: null,
  delayedChildRefresh: null,
  errors: [],
  popupRuntimeEvents: [],
  coverage: [
    'Page routes are fulfilled locally; no real Bilibili, YouTube, or personal browser profile is used.',
    'Toolbar popup attempts use chrome.action.openPopup in this dedicated headed Chromium profile.',
    'The controlled child-frame refresh delay is installed only by this test harness.',
  ],
  cleanup: { temporaryProfileCreated: false, temporaryProfileRemoved: false },
};

async function runtimeHash() {
  const names = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(full);
      else names.push(path.relative(extension, full).replaceAll('\\', '/'));
    }
  }
  await visit(extension);
  const hash = createHash('sha256');
  for (const name of names.sort()) {
    hash.update(name).update('\0').update(await readFile(path.join(extension, name))).update('\0');
  }
  return hash.digest('hex');
}

function fixture(url) {
  if (url.pathname === '/qa-away') {
    return '<!doctype html><meta charset="utf-8"><title>Isolated away window</title><body>QA away window</body>';
  }
  if (url.pathname === '/qa-embed') {
    return '<!doctype html><meta charset="utf-8"><title>' + childTitle +
      '</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}video{display:block;width:640px;height:360px;background:#111}</style>' +
      '<div class="bpx-player-container" data-video-title="' + childTitle + '">' +
      '<video id="qa-child" data-video-title="' + childTitle +
      '" muted loop playsinline preload="auto" src="/qa-tiny.webm?frame=child"></video></div>' +
      '<script>document.querySelector("#qa-child").play().catch(()=>{});</script>';
  }
  const childFrame = url.searchParams.get('child') === '1'
    ? '<iframe id="qa-child-frame" title="Bilibili-shaped child frame" src="/qa-embed"></iframe>'
    : '';
  if (qaSite === 'youtube') {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + mainTitle +
      ' - YouTube</title><meta property="og:title" content="' + mainTitle +
      '"><style>html,body{margin:0;min-height:100%;font:16px Arial,sans-serif;background:#f8f8f8}' +
      '#movie_player{position:absolute;left:50%;top:20px;transform:translateX(-50%);width:760px;height:400px;background:#101820}' +
      '.html5-video-container,.video-stream{width:100%;height:100%;object-fit:contain}' +
      '#below{position:absolute;left:calc(50% - 380px);top:435px;width:760px}' +
      '#secondary{position:fixed;right:20px;bottom:20px;width:180px;height:110px;background:#202830;color:white}' +
      '#secondary video{width:180px;height:100px;object-fit:contain}' +
      '#qa-child-frame{position:absolute;left:20px;top:650px;width:280px;height:170px;border:0;background:#171717}' +
      '</style></head><body><ytd-app><ytd-page-manager><ytd-watch-flexy>' +
      '<div id="primary"><div id="player"><div id="movie_player" class="html5-video-player">' +
      '<div class="html5-video-container"><video id="qa-main" class="video-stream html5-main-video" data-video-title="' +
      mainTitle + '" autoplay muted loop playsinline controls preload="auto" src="/qa-tiny.webm?frame=main"></video></div></div></div>' +
      '<div id="below"><div id="title"><h1><yt-formatted-string>' + mainTitle + '</yt-formatted-string></h1></div></div></div>' +
      '<div id="secondary"><ytd-watch-next-secondary-results-renderer><ytd-compact-video-renderer>' +
      '<video id="qa-preview" data-video-title="' + previewTitle +
      '" autoplay muted loop playsinline preload="auto" src="/qa-tiny.webm?frame=preview"></video>' +
      '<span>' + previewTitle + '</span></ytd-compact-video-renderer></ytd-watch-next-secondary-results-renderer></div>' +
      childFrame + '</ytd-watch-flexy></ytd-page-manager></ytd-app>' +
      '<script>window.__qa={keyEvents:[]};const qaLog=e=>window.__qa.keyEvents.push({type:e.type,key:e.key,trusted:e.isTrusted,at:Date.now()});window.addEventListener("keydown",qaLog,true);window.addEventListener("keyup",qaLog,true);' +
      'document.querySelector("#qa-main").play().catch(()=>{});document.querySelector("#qa-preview").play().catch(()=>{});</script>' +
      '</body></html>';
  }
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>' + mainTitle +
    '_哔哩哔哩_bilibili</title><meta property="og:title" content="' + mainTitle +
    '"><style>html,body{margin:0;min-height:100%;font:16px system-ui;background:#eef1f5}' +
    '#bilibili-player{position:absolute;left:50%;top:20px;transform:translateX(-50%);width:760px;height:400px;background:#101820}' +
    '#bilibili-player video{width:100%;height:100%;object-fit:contain}' +
    '.bpx-player-title{position:absolute;left:8px;top:8px;color:white}' +
    '.bili-video-card{position:fixed;right:20px;bottom:20px;width:180px;height:100px;background:#202830}' +
    '.bili-video-card video{width:180px;height:100px;object-fit:contain}' +
    '#qa-child-frame{position:absolute;left:20px;top:520px;width:280px;height:170px;border:0;background:#171717}' +
    '</style></head><body><h1 class="video-info-title">' + mainTitle + '</h1>' +
    '<div id="bilibili-player" class="bpx-player-container" data-video-title="' + mainTitle +
    '"><span class="bpx-player-title">' + mainTitle + '</span><video id="qa-main" data-video-title="' +
    mainTitle + '" autoplay muted loop playsinline controls preload="auto" src="/qa-tiny.webm?frame=main"></video></div>' +
    '<aside class="bili-video-card" data-video-title="' + previewTitle +
    '"><video id="qa-preview" data-video-title="' + previewTitle +
    '" autoplay muted loop playsinline preload="auto" src="/qa-tiny.webm?frame=preview"></video></aside>' +
    childFrame +
    '<script>window.__qa={keyEvents:[]};const qaLog=e=>window.__qa.keyEvents.push({type:e.type,key:e.key,trusted:e.isTrusted,at:Date.now()});window.addEventListener("keydown",qaLog,true);window.addEventListener("keyup",qaLog,true);' +
    'document.querySelector("#qa-main").play().catch(()=>{});document.querySelector("#qa-preview").play().catch(()=>{});</script>' +
    '</body></html>';
}

async function waitFor(predicate, message, timeout = 8000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(50);
  }
  throw new Error(message + (last ? ': ' + (last.message || String(last)) : ''));
}

function currentWorker() {
  return context?.serviceWorkers()?.find(item => item.url().includes('/background.js')) || worker;
}

async function targetInfos() {
  try {
    return (await cdp.send('Target.getTargets')).targetInfos || [];
  } catch (error) {
    report.errors.push({ stage: 'Target.getTargets', message: String(error?.message || error) });
    return [];
  }
}

async function cdpTargetCommand(sessionId, method, params = {}) {
  const id = ++nestedCdpMessageId;
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      cdp.off('Target.receivedMessageFromTarget', receive);
      reject(new Error('Nested CDP command timed out: ' + method));
    }, 5000);
    const receive = event => {
      if (event.sessionId !== sessionId) return;
      let message;
      try { message = JSON.parse(event.message); } catch { return; }
      if (message.id !== id) return;
      clearTimeout(timer);
      cdp.off('Target.receivedMessageFromTarget', receive);
      if (message.error) reject(new Error(message.error.message || method + ' failed'));
      else resolve(message.result || {});
    };
    cdp.on('Target.receivedMessageFromTarget', receive);
    try {
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      });
    } catch (error) {
      clearTimeout(timer);
      cdp.off('Target.receivedMessageFromTarget', receive);
      reject(error);
    }
  });
}

async function popupDomSnapshotCdp(sessionId, popupOpenRequestedAt = null) {
  const waitStartedAt = Date.now();
  await waitFor(async () => {
    const state = await cdpTargetCommand(sessionId, 'Runtime.evaluate', {
      expression: '!!document.body&&document.body.getAttribute("aria-busy")!=="true"&&!document.body.classList.contains("loading")',
      returnByValue: true,
    });
    return state?.result?.value === true;
  }, 'popup aria-busy did not clear before the 3s diagnostic limit', 3000).catch(() => null);
  const loadingWaitMs = Date.now() - waitStartedAt;
  const expression = '(async()=>{const cached=await new Promise(resolve=>chrome.runtime.sendMessage({scope:"video-control",action:"cachedState"},response=>resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:response)));const id=value=>document.getElementById(value);return JSON.stringify({cached,ui:{documentTitle:document.title,bodyClass:document.body.className,targetText:id("single-target")?.textContent?.trim()||"",targetTooltip:id("single-target")?.title||"",controlsHidden:id("controls")?.hidden??null,playbackHidden:id("playback")?.hidden??null,rateValue:id("current-rate")?.value||"",rateDisabled:id("current-rate")?.disabled??null,sliderDisabled:id("rate-slider")?.disabled??null,enabledDisabled:id("enabled")?.disabled??null,commandButtons:[...document.querySelectorAll("[data-command]")].map(button=>({id:button.id,disabled:button.disabled})),busy:document.body.getAttribute("aria-busy"),viewport:{width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio}}})})()';
  const result = await cdpTargetCommand(sessionId, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  const raw = result?.result?.value;
  if (typeof raw !== 'string') return { accessible: false, error: 'popup DOM expression returned no value', protocol: result };
  try {
    const value = JSON.parse(raw);
    value.ui.loadingWaitMs = loadingWaitMs;
    value.ui.openedToReadyMs = popupOpenRequestedAt ? Date.now() - Date.parse(popupOpenRequestedAt) : null;
    let getStateProbe = null;
    if ((value.ui.busy === 'true' || value.ui.bodyClass.includes('loading')) && !popupGetStateProbed.has(sessionId)) {
      popupGetStateProbed.add(sessionId);
      const tabId = Number.isInteger(value.cached?.tabId) ? value.cached.tabId : undefined;
      const probeExpression = `(()=>new Promise(resolve=>{const started=performance.now();let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value)};const timer=setTimeout(()=>finish({timedOut:true,elapsedMs:performance.now()-started}),3000);chrome.runtime.sendMessage({scope:"video-control",action:"getState"${tabId === undefined ? '' : ',tabId:' + tabId}},response=>finish({timedOut:false,elapsedMs:performance.now()-started,ok:response?.ok===true,error:response?.error||chrome.runtime.lastError?.message||null,target:response?.target||null,videoCount:response?.videos?.length||0}))}))()`;
      const probe = await cdpTargetCommand(sessionId, 'Runtime.evaluate', {
        expression: probeExpression, returnByValue: true, awaitPromise: true,
      }).catch(error => ({ error: String(error?.message || error) }));
      getStateProbe = {
        harnessOnly: true,
        separateMessageSideEffect: true,
        note: 'Separate getState message sent after the initial UI snapshot; it may refresh background cache.',
        result: probe?.result?.value || probe.error || null,
      };
    }
    return { accessible: true, ui: value.ui, cachedState: value.cached, getStateProbe,
      via: 'CDP attached to actual chrome.action popup target' };
  } catch (error) {
    return { accessible: false, error: 'could not parse popup DOM: ' + String(error?.message || error), raw };
  }
}

async function saveCdpPopupShot(sessionId, name) {
  const result = await cdpTargetCommand(sessionId, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (!result?.data) return null;
  const file = path.join(output, name + '.png');
  await writeFile(file, Buffer.from(result.data, 'base64'));
  return path.relative(root, file).replaceAll('\\', '/');
}

async function workerCall(fn, arg) {
  const current = currentWorker();
  if (!current) throw new Error('extension service worker is unavailable');
  return current.evaluate(fn, arg);
}

async function browserState(tabId) {
  return workerCall(async id => {
    const [windows, lastFocused, currentActive, tab, session] = await Promise.all([
      chrome.windows.getAll({ populate: true }),
      chrome.windows.getLastFocused(),
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.get(id).catch(error => ({ error: error.message })),
      chrome.storage.session.get('tabActivity'),
    ]);
    const activity = session.tabActivity || {};
    const key = String(id);
    return {
      windows: windows.map(win => ({
        id: win.id, focused: win.focused === true, state: win.state, type: win.type,
        activeTabIds: (win.tabs || []).filter(item => item.active).map(item => item.id),
        urls: (win.tabs || []).map(item => ({ id: item.id, active: item.active, url: item.url })),
      })),
      lastFocused: { id: lastFocused?.id ?? null, focused: lastFocused?.focused === true, type: lastFocused?.type },
      activeCurrentWindow: currentActive.map(item => ({ id: item.id, active: item.active, url: item.url, windowId: item.windowId })),
      fixtureTab: { id: tab.id ?? id, active: tab.active, status: tab.status, url: tab.url, windowId: tab.windowId, error: tab.error },
      tabActivity: {
        focusedWindowId: activity.focusedWindowId ?? null,
        focusedTabId: activity.focusedTabId ?? null,
        focused: activity.focusedTabId === id && activity.focusedWindowId === tab.windowId,
        until: activity.untilByTab?.[key] ?? activity.untilByTab?.[id] ?? null,
        loadingUntil: activity.loadingUntilByTab?.[key] ?? activity.loadingUntilByTab?.[id] ?? null,
        revision: activity.revision ?? null,
        raw: activity,
      },
    };
  }, tabId);
}

async function focusFixtureTab(tabId) {
  const before = await browserState(tabId).catch(error => ({ error: String(error?.message || error) }));
  const windowId = before.fixtureTab?.windowId;
  if (!Number.isInteger(windowId)) return { before, request: { ok: false, error: 'fixture window id unavailable' }, after: before };
  const requestedAt = new Date().toISOString();
  const waitStartedAt = Date.now();
  let request;
  try {
    request = await workerCall(async ({ windowId: targetWindowId, tabId: targetTabId }) => {
      const window = await chrome.windows.update(targetWindowId, { focused: true });
      const tab = await chrome.tabs.update(targetTabId, { active: true });
      return { ok: true, windowId: window.id, windowFocused: window.focused === true, tabId: tab.id, tabActive: tab.active === true };
    }, { windowId, tabId });
  } catch (error) { request = { ok: false, error: String(error?.message || error) }; }
  const after = await waitFor(async () => {
    const state = await browserState(tabId);
    const ownerWindow = state.windows?.find(window => window.id === windowId);
    return state.lastFocused?.focused === true && ownerWindow?.focused === true &&
      state.activeCurrentWindow?.some(tab => tab.id === tabId && tab.active) && state.tabActivity?.focused === true
      ? state : null;
  }, 'dedicated QA window and tab activity did not report focused=true after activation', 4000).catch(async error => {
    const state = await browserState(tabId).catch(inner => ({ error: String(inner?.message || inner) }));
    return { ...state, focusWaitError: String(error?.message || error) };
  });
  return { windowId, request, requestedAt, verifiedAt: new Date().toISOString(), waitMs: Date.now() - waitStartedAt, before, after };
}

async function runNoPopupHotkey(tabId, page) {
  const apiReady = await waitFor(async () => {
    const frames = await apiFrames(tabId);
    const top = frames.find(frame => frame.frameId === 0)?.result;
    return top?.alive && top?.enabled && top.snapshot?.length ? top : null;
  }, 'no-popup hotkey fixture did not register its main video', 10000).catch(error => ({ error: String(error?.message || error) }));
  const before = await readFixtureMedia(page);
  const focusRestore = await focusFixtureTab(tabId);
  const ownerWindow = focusRestore.after?.windows?.find(window => window.id === focusRestore.windowId);
  const focusVerified = focusRestore.after?.lastFocused?.focused === true && ownerWindow?.focused === true &&
    focusRestore.after?.tabActivity?.focused === true &&
    focusRestore.after?.activeCurrentWindow?.some(tab => tab.id === tabId && tab.active);
  if (focusVerified) {
    await page.keyboard.press('Shift+Period').catch(error => { report.errors.push({ stage: 'no-popup-hotkey', message: String(error?.message || error) }); });
    await sleep(350);
  }
  const after = await readFixtureMedia(page);
  const topAfter = (await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) })))
    .find?.(frame => frame.frameId === 0)?.result;
  const target = topAfter?.snapshot?.find(video => video.id === after.main?.registryId) || null;
  const diagnostic = topAfter?.diagnostics?.find(item => item.id === after.main?.registryId) || null;
  const keyEvents = after.keyEvents.slice(before.keyEvents.length);
  const trustedGreaterThanKeyup = keyEvents.some(event => event.type === 'keyup' && event.key === '>' && event.trusted);
  const commandApplied = diagnostic?.rateOrigin === 'command' || diagnostic?.events?.some(event => event.kind === 'applied' && event.source === 'command');
  const toastMatchesRate = after.toastText === Number(Number(after.main?.rate).toFixed(2)).toString() + '×';
  return {
    popupOpened: false,
    apiReady: !!(apiReady?.alive && apiReady?.enabled && apiReady?.snapshot?.length),
    focusRestore,
    focusVerified,
    trustedGreaterThanSeen: focusVerified && trustedGreaterThanKeyup,
    trustedGreaterThanKeyup,
    beforeRate: before.main?.rate ?? null,
    afterRate: after.main?.rate ?? null,
    changed: Math.abs(Number(after.main?.rate) - Number(before.main?.rate)) > 0.001,
    rateOrigin: diagnostic?.rateOrigin || null,
    commandApplied,
    toastText: after.toastText,
    toastMatchesRate,
    mainVideoId: after.main?.id || null,
    mainTitle: after.main?.title || null,
    mainRegistryId: after.main?.registryId || null,
    apiTarget: target ? { id: target.id, frameId: target.frameId, title: target.title, rate: target.rate } : null,
    apiDiagnostics: diagnostic,
    focusAfterKey: await browserState(tabId).catch(error => ({ error: String(error?.message || error) })),
    keyEvents,
  };
}

async function runAwayHotkeyProbe(tabId, page) {
  const storageMemoryBefore = await readStoredRatePair();
  const before = await readFixtureMedia(page);
  const beforeFrames = await apiFrames(tabId);
  const beforeTop = beforeFrames.find(frame => frame.frameId === 0)?.result;
  const beforeDiagnostic = beforeTop?.diagnostics?.find(item => item.id === before.main?.registryId);
  const beforeCommandCount = beforeDiagnostic?.events?.filter(event => event.kind === 'applied' && event.source === 'command').length || 0;
  const protocol = await context.newCDPSession(page);
  let dispatch = { ok: false };
  try {
    await protocol.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
    });
    await protocol.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: '>', code: 'Period', text: '>', unmodifiedText: '.', modifiers: 8,
      windowsVirtualKeyCode: 190, nativeVirtualKeyCode: 190,
    });
    await protocol.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: '>', code: 'Period', modifiers: 8, windowsVirtualKeyCode: 190, nativeVirtualKeyCode: 190,
    });
    await protocol.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
    });
    dispatch = { ok: true, method: 'CDP Input.dispatchKeyEvent to inactive fixture tab' };
  } catch (error) { dispatch = { ok: false, error: String(error?.message || error) }; }
  await sleep(250);
  const after = await readFixtureMedia(page);
  const afterFrames = await apiFrames(tabId);
  const afterTop = afterFrames.find(frame => frame.frameId === 0)?.result;
  const afterDiagnostic = afterTop?.diagnostics?.find(item => item.id === after.main?.registryId);
  const afterCommandCount = afterDiagnostic?.events?.filter(event => event.kind === 'applied' && event.source === 'command').length || 0;
  const focus = await browserState(tabId).catch(error => ({ error: String(error?.message || error) }));
  const ownerWindow = focus.windows?.find(window => window.id === focus.fixtureTab?.windowId);
  const keyEvents = after.keyEvents.slice(before.keyEvents.length);
  const trustedGreaterThanKeyup = keyEvents.some(event => event.type === 'keyup' && event.key === '>' && event.trusted);
  const changed = Math.abs(Number(after.main?.rate) - Number(before.main?.rate)) > 0.001;
  const commandApplied = afterCommandCount > beforeCommandCount;
  const controlCommand = await backgroundControlProbe(tabId);
  const afterControlMedia = await readFixtureMedia(page);
  const afterControlFrames = await apiFrames(tabId);
  const afterControlTop = afterControlFrames.find(frame => frame.frameId === 0)?.result;
  const afterControlDiagnostic = afterControlTop?.diagnostics?.find(item => item.id === afterControlMedia.main?.registryId);
  const afterControlFocus = await browserState(tabId).catch(error => ({ error: String(error?.message || error) }));
  const afterControlWindow = afterControlFocus.windows?.find(window => window.id === afterControlFocus.fixtureTab?.windowId);
  const storageMemoryAfter = await readStoredRatePair();
  const memoryObserved = Number.isFinite(storageMemoryBefore?.lastRate) &&
    Number.isSafeInteger(storageMemoryBefore?.lastRateRevision) &&
    Number.isFinite(storageMemoryAfter?.lastRate) &&
    Number.isSafeInteger(storageMemoryAfter?.lastRateRevision);
  const memoryUnchanged = memoryObserved &&
    storageMemoryBefore.lastRate === storageMemoryAfter.lastRate &&
    storageMemoryBefore.lastRateRevision === storageMemoryAfter.lastRateRevision;
  const registrationIdsBefore = (beforeTop?.videoElements || []).map(video => [video.id, video.registryId]);
  const registrationIdsAfter = (afterControlTop?.videoElements || []).map(video => [video.id, video.registryId]);
  const snapshotIdsBefore = (beforeTop?.snapshot || []).map(video => video.id);
  const snapshotIdsAfter = (afterControlTop?.snapshot || []).map(video => video.id);
  const noActiveExploration = JSON.stringify(registrationIdsBefore) === JSON.stringify(registrationIdsAfter) &&
    JSON.stringify(snapshotIdsBefore) === JSON.stringify(snapshotIdsAfter);
  await protocol.detach().catch(() => {});
  return {
    tabId,
    dispatch,
    focus,
    focusStayedAway: focus.tabActivity?.focused === false && ownerWindow?.focused === false,
    beforeRate: before.main?.rate ?? null,
    afterRate: after.main?.rate ?? null,
    changed,
    trustedGreaterThanKeyup,
    keyEvents,
    snapshotCountBefore: beforeTop?.snapshot?.length ?? null,
    snapshotCountAfter: afterTop?.snapshot?.length ?? null,
    rateOriginAfter: afterDiagnostic?.rateOrigin || null,
    commandApplied,
    beforeCommandCount,
    afterCommandCount,
    controlCommand,
    controlProbeRate: afterControlMedia.main?.rate ?? null,
    controlProbeRejected: controlCommand?.response?.ok === false,
    memoryBefore: memoryObserved ? storageMemoryBefore : null,
    memoryAfter: memoryObserved ? storageMemoryAfter : null,
    memoryObserved,
    memoryObservation: 'chrome.storage.local lastRate/lastRateRevision pair read in the extension service worker',
    apiDiagnosticMemoryBefore: beforeDiagnostic?.memory ?? null,
    apiDiagnosticMemoryAfter: afterControlDiagnostic?.memory ?? null,
    memoryUnchanged,
    pendingUntilBefore: beforeDiagnostic?.pendingUntil ?? null,
    pendingUntilAfter: afterControlDiagnostic?.pendingUntil ?? null,
    initializedBefore: beforeDiagnostic?.initialized ?? null,
    rateStatusBefore: beforeDiagnostic?.rateStatus || null,
    rateOriginBefore: beforeDiagnostic?.rateOrigin || null,
    noActiveExploration,
    blocked: dispatch.ok && focus.tabActivity?.focused === false && ownerWindow?.focused === false &&
      afterControlFocus.tabActivity?.focused === false && afterControlWindow?.focused === false &&
      trustedGreaterThanKeyup && !changed && afterControlMedia.main?.rate === before.main?.rate &&
      !commandApplied && controlCommand?.response?.ok === false && memoryObserved && memoryUnchanged && noActiveExploration,
  };
}

async function readStoredRatePair() {
  return workerCall(async () => {
    const value = await chrome.storage.local.get(['lastRate', 'lastRateRevision']);
    return { lastRate: value.lastRate, lastRateRevision: value.lastRateRevision };
  });
}

async function apiFrames(tabId) {
  return workerCall(async id => {
    const rows = await chrome.scripting.executeScript({
      injectImmediately: true,
      target: { tabId: id, allFrames: true },
      world: 'ISOLATED',
      func: () => {
        const api = globalThis[Symbol.for('video-control.api')];
        let snapshot = [], diagnostics = [];
        try { snapshot = api?.snapshot?.() || []; } catch {}
        try { diagnostics = api?.diagnostics?.() || []; } catch {}
        return {
          href: location.href,
          apiPresent: !!api,
          version: api?.version || null,
          alive: !!api?.alive?.(),
          enabled: !!api?.enabled?.(),
          snapshot: snapshot.map(item => ({
            id: item.id, title: item.title, rate: item.rate, rateStatus: item.rateStatus, rateOrigin: item.rateOrigin, playing: item.playing,
            visible: item.visible, visibleArea: item.visibleArea, visibleRatio: item.visibleRatio,
            connected: item.connected, frameId: item.frameId,
          })),
          diagnostics: diagnostics.map(item => ({
            id: item.id, rate: item.rate, desiredRate: item.desiredRate, rateStatus: item.rateStatus,
            rateOrigin: item.rateOrigin, rateError: item.rateError,
            pendingUntil: item.pendingUntil ?? null, initialized: item.rateStatus === 'ready',
            memory: item.memory ?? null,
            bridge: item.bridge ? { status: item.bridge.status || null, adapter: item.bridge.adapter || null,
              events: item.bridge.events?.slice?.(-8) || [] } : null,
            events: (item.events || []).slice(-12),
          })),
          toastText: (() => {
            const toast = document.querySelector('#video-control-toast');
            return toast?.shadowRoot?.querySelector('span')?.textContent?.trim() || null;
          })(),
          videoElements: [...document.querySelectorAll('video')].map(video => ({
            id: video.id, title: video.getAttribute('data-video-title'),
            registryId: video.getAttribute('data-video-control-id'),
            rate: video.playbackRate, paused: video.paused,
            box: (() => { const r = video.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
          })),
          highlight: (() => {
            const node = document.querySelector('[data-video-control-media-highlight]');
            if (!node) return null;
            const label = node.querySelector('span');
            const r = node.getBoundingClientRect();
            const video = document.querySelector('#qa-main');
            const v = video?.getBoundingClientRect();
            const overlapsMainVideo = !!v && r.width > 0 && r.height > 0 &&
              r.right > v.left && r.left < v.right && r.bottom > v.top && r.top < v.bottom;
            return { marker: node.getAttribute('data-video-control-media-highlight'),
              title: label?.textContent || '', border: getComputedStyle(node).border,
              box: { x: r.x, y: r.y, width: r.width, height: r.height }, overlapsMainVideo };
          })(),
        };
      },
    });
    return rows.map(row => ({ frameId: row.frameId, documentId: row.documentId, result: row.result }));
  }, tabId);
}

async function popupTargets() {
  const prefix = 'chrome-extension://' + extensionId + '/popup.html';
  const pages = context.pages().filter(page => page.url().startsWith(prefix));
  const targets = (await targetInfos()).filter(item => item.url?.startsWith(prefix));
  return { pages, targets };
}

async function openToolbarPopup(label) {
  const beforeTargets = await targetInfos();
  const beforePopupIds = new Set(beforeTargets.filter(item => item.url?.startsWith('chrome-extension://' + extensionId + '/popup.html')).map(item => item.targetId));
  const popupOpenRequestedAt = new Date().toISOString();
  const attempt = await workerCall(async () => {
    if (typeof chrome.action.openPopup !== 'function') return { ok: false, unsupported: true, error: 'chrome.action.openPopup is unavailable' };
    try { await chrome.action.openPopup(); return { ok: true }; }
    catch (error) { return { ok: false, error: String(error?.message || error) }; }
  });
  let observed = null;
  try {
    observed = await waitFor(async () => {
      const state = await popupTargets();
      const page = state.pages.find(item => !item.isClosed());
      if (page) return { page, target: state.targets.find(item => item.url === page.url()) || null };
      const createdTarget = state.targets.find(item => !beforePopupIds.has(item.targetId));
      if (createdTarget) return { page: null, target: createdTarget };
      return null;
    }, 'toolbar popup target was not observable', 2500);
  } catch {}
  return { label, attempt, page: observed?.page || null, target: observed?.target || null,
    popupOpenRequestedAt, targetObservedAt: observed ? new Date().toISOString() : null };
}

async function closeToolbarPopup(opened) {
  try { if (opened?.page && !opened.page.isClosed()) await opened.page.close(); } catch {}
  if (opened?.sessionId) {
    try {
      await cdpTargetCommand(opened.sessionId, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
      await cdpTargetCommand(opened.sessionId, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
      });
      opened.closeObserved = await waitFor(async () => {
        return !(await targetInfos()).some(target => target.targetId === opened.target?.targetId);
      }, 'Escape did not dismiss the action popup', 1000).catch(() => false);
      if (opened.closeObserved) opened.closeMethod = 'trusted CDP Escape in actual action popup';
    } catch (error) {
      opened.closeEscapeError = String(error?.message || error);
    }
    if (opened.runtimeEventListener) cdp.off('Target.receivedMessageFromTarget', opened.runtimeEventListener);
    try { await cdp.send('Target.detachFromTarget', { sessionId: opened.sessionId }); } catch {}
  }
  if (opened?.target?.targetId && !opened.page && !opened.closeObserved) {
    opened.closeMethod = 'Target.closeTarget fallback (not a normal popup dismissal)';
    try { await cdp.send('Target.closeTarget', { targetId: opened.target.targetId }); } catch {}
  }
}

async function popupDomSnapshot(popup, popupOpenRequestedAt = null) {
  try {
    await popup.waitForSelector('#single-target', { timeout: 4000 });
    const waitStartedAt = Date.now();
    await popup.waitForFunction(() => !!document.body && document.body.getAttribute('aria-busy') !== 'true' &&
      !document.body.classList.contains('loading'), null, { timeout: 3000 }).catch(() => {});
    const loadingWaitMs = Date.now() - waitStartedAt;
    const cached = await popup.evaluate(() => new Promise(resolve => {
      chrome.runtime.sendMessage({ scope: 'video-control', action: 'cachedState' }, response => {
        resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : response);
      });
    }));
    const ui = await popup.evaluate(() => {
      const id = value => document.getElementById(value);
      return {
        documentTitle: document.title,
        bodyClass: document.body.className,
        targetText: id('single-target')?.textContent?.trim() || '',
        targetTooltip: id('single-target')?.title || '',
        controlsHidden: id('controls')?.hidden ?? null,
        playbackHidden: id('playback')?.hidden ?? null,
        rateValue: id('current-rate')?.value || '',
        rateDisabled: id('current-rate')?.disabled ?? null,
        sliderDisabled: id('rate-slider')?.disabled ?? null,
        enabledDisabled: id('enabled')?.disabled ?? null,
        commandButtons: [...document.querySelectorAll('[data-command]')].map(button => ({ id: button.id, disabled: button.disabled })),
        busy: document.body.getAttribute('aria-busy'),
        viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
      };
    });
    ui.loadingWaitMs = loadingWaitMs;
    ui.openedToReadyMs = popupOpenRequestedAt ? Date.now() - Date.parse(popupOpenRequestedAt) : null;
    return { accessible: true, ui, cachedState: cached };
  } catch (error) {
    return { accessible: false, error: String(error?.message || error) };
  }
}

async function inspectToolbarTarget(opened, name) {
  if (opened?.page) return {
    dom: await popupDomSnapshot(opened.page, opened.popupOpenRequestedAt),
    screenshot: await saveShot(opened.page, name + '-toolbar-popup'),
    attachedForDom: false,
  };
  if (!opened?.target?.targetId) return { dom: { accessible: false, note: 'No observable action popup target.' }, screenshot: null, attachedForDom: false };
  try {
    const attached = await cdp.send('Target.attachToTarget', { targetId: opened.target.targetId, flatten: false });
    opened.sessionId = attached.sessionId;
    opened.runtimeEventListener = event => {
      if (event.sessionId !== opened.sessionId) return;
      let message;
      try { message = JSON.parse(event.message); } catch { return; }
      if (!['Runtime.exceptionThrown', 'Runtime.consoleAPICalled'].includes(message.method)) return;
      const params = message.params || {};
      report.popupRuntimeEvents.push({
        at: new Date().toISOString(), targetId: opened.target.targetId, method: message.method,
        text: params.exceptionDetails?.text || params.exceptionDetails?.exception?.description ||
          params.args?.map(arg => arg.value ?? arg.description ?? '').join(' ') || '',
        url: params.exceptionDetails?.url || params.stackTrace?.callFrames?.[0]?.url || null,
        lineNumber: params.exceptionDetails?.lineNumber ?? null,
        type: params.type || null,
      });
    };
    cdp.on('Target.receivedMessageFromTarget', opened.runtimeEventListener);
    await cdpTargetCommand(opened.sessionId, 'Runtime.enable');
    await cdpTargetCommand(opened.sessionId, 'Page.enable');
    await waitFor(async () => {
      const state = await cdpTargetCommand(opened.sessionId, 'Runtime.evaluate', {
        expression: 'document.readyState==="complete"&&!!document.getElementById("single-target")',
        returnByValue: true,
      });
      return state?.result?.value === true;
    }, 'actual toolbar popup document did not finish loading', 5000);
    return {
      dom: await popupDomSnapshotCdp(opened.sessionId, opened.popupOpenRequestedAt),
      screenshot: await saveCdpPopupShot(opened.sessionId, name + '-toolbar-popup'),
      attachedForDom: true,
    };
  } catch (error) {
    report.errors.push({ stage: 'toolbar-popup-dom:' + name, message: String(error?.message || error) });
    return { dom: { accessible: false, error: String(error?.message || error) }, screenshot: null, attachedForDom: false };
  }
}

async function clickPopupCommandCdp(sessionId, selector) {
  const located = await cdpTargetCommand(sessionId, 'Runtime.evaluate', {
    expression: `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:e.disabled}})()`,
    returnByValue: true,
  });
  const point = located?.result?.value;
  if (!point || point.disabled) return { clicked: false, reason: point ? 'disabled' : 'missing' };
  await cdpTargetCommand(sessionId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
  await cdpTargetCommand(sessionId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
  return { clicked: true, selector, point };
}

async function pageApiSnapshot(tabId) {
  const frames = await apiFrames(tabId);
  return frames.find(frame => frame.frameId === 0)?.result || null;
}

async function holdToolbarPopup(opened, page, tabId, durationMs) {
  const result = { requestedMs: durationMs, startedAt: new Date().toISOString(), samples: [] };
  const before = await readFixtureMedia(page);
  result.control = { beforeRate: before.main?.rate ?? null, click: null, afterRate: null, changed: false };
  if (opened.sessionId) {
    result.control.click = await clickPopupCommandCdp(opened.sessionId, '#next-step').catch(error => ({
      clicked: false, error: String(error?.message || error),
    }));
  } else {
    result.control.click = { clicked: false, reason: 'native popup CDP session unavailable' };
  }
  const changed = await waitFor(async () => {
    const state = await readFixtureMedia(page);
    if (Math.abs(Number(state.main?.rate) - Number(before.main?.rate)) > 0.001) return state;
    return null;
  }, 'popup command did not change main video rate', 1800).catch(() => null);
  const afterControl = changed || await readFixtureMedia(page);
  result.control.afterRate = afterControl.main?.rate ?? null;
  result.control.changed = Math.abs(Number(result.control.afterRate) - Number(result.control.beforeRate)) > 0.001;
  result.control.mainRegistryId = afterControl.main?.registryId || null;

  const openedAt = Date.now();
  let previousElapsed = 0;
  for (const elapsedMs of [5000, 12000, durationMs]) {
    const waitMs = Math.max(0, elapsedMs - previousElapsed);
    if (waitMs) await sleep(waitMs);
    const [popup, focus, main, api] = await Promise.all([
      opened.sessionId ? popupDomSnapshotCdp(opened.sessionId) : Promise.resolve({ accessible: false }),
      browserState(tabId).catch(error => ({ error: String(error?.message || error) })),
      readFixtureMedia(page).catch(error => ({ error: String(error?.message || error) })),
      pageApiSnapshot(tabId).catch(error => ({ error: String(error?.message || error) })),
    ]);
    result.samples.push({
      scheduledElapsedMs: elapsedMs,
      actualElapsedMs: Date.now() - openedAt,
      at: new Date().toISOString(),
      popup,
      focus,
      mainRate: main.main?.rate ?? null,
      mainRegistryId: main.main?.registryId ?? null,
      snapshot: api?.snapshot || [],
      mainTargetTitle: api?.snapshot?.find(video => video.id === main.main?.registryId)?.title || null,
      highlight: api?.highlight || null,
    });
    previousElapsed = elapsedMs;
  }
  result.persistent = result.samples.length === 3 && result.samples.every(sample =>
    sample.popup?.accessible && sample.popup?.ui?.targetText === sample.mainTargetTitle &&
    sample.popup?.cachedState?.target?.id === sample.mainRegistryId &&
    sample.popup?.cachedState?.target?.title === sample.mainTargetTitle);
  result.heldMs = Date.now() - openedAt;
  return result;
}

async function saveShot(page, name) {
  if (!page || page.isClosed()) return null;
  const file = path.join(output, name + '.png');
  try { await page.screenshot({ path: file, timeout: 5000 }); return path.relative(root, file).replaceAll('\\', '/'); }
  catch (error) { report.errors.push({ stage: 'screenshot:' + name, message: String(error?.message || error) }); return null; }
}

async function saveReport() {
  await mkdir(output, { recursive: true });
  await mkdir(qaDirectory, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

async function checkpoint(name, elapsedMs, tabId, page = host, activeStart = report.page?.activeStart, options = {}) {
  const item = { name, scheduledElapsedMs: elapsedMs, requestedAt: new Date().toISOString(), actualElapsedMs: null };
  item.trialPageUrl = page.url();
  item.before = { focus: await browserState(tabId).catch(error => ({ error: String(error?.message || error) })), apiFrames: await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) })) };
  item.before.mainMedia = await readFixtureMedia(page).catch(error => ({ error: String(error?.message || error) }));
  const opened = await openToolbarPopup(name);
  item.toolbarPopup = { action: opened.attempt, target: opened.target ? {
    type: opened.target.type, targetId: opened.target.targetId, url: opened.target.url, attached: opened.target.attached,
  } : null, accessiblePage: !!opened.page };
  item.openedAt = new Date().toISOString();
  item.actualElapsedMs = Date.parse(item.openedAt) - Date.parse(activeStart || item.openedAt);
  item.during = {
    focus: await browserState(tabId).catch(error => ({ error: String(error?.message || error) })),
    apiFrames: await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) })),
  };
  const inspection = await inspectToolbarTarget(opened, name);
  item.popup = inspection.dom;
  item.screenshot = inspection.screenshot;
  item.toolbarPopup.attachedForDom = inspection.attachedForDom;
  let uiFrames = await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) }));
  const markerDeadline = Date.now() + 1200;
  while (Date.now() < markerDeadline && !uiFrames.some(frame => frame.frameId === 0 && frame.result?.highlight)) {
    await sleep(80);
    uiFrames = await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) }));
  }
  item.duringAfterPopupUi = {
    focus: await browserState(tabId).catch(error => ({ error: String(error?.message || error) })),
    apiFrames: uiFrames,
  };
  if (options.holdOpenMs > 0) item.popupHold = await holdToolbarPopup(opened, page, tabId, options.holdOpenMs);
  await closeToolbarPopup(opened);
  item.toolbarPopup.closeMethod = opened.closeMethod || (opened.page ? 'Playwright page close' : null);
  item.toolbarPopup.closeObserved = opened.closeObserved ?? null;
  item.toolbarPopup.closeEscapeError = opened.closeEscapeError || null;
  await sleep(150);
  item.afterClose = {
    focus: await browserState(tabId).catch(error => ({ error: String(error?.message || error) })),
    apiFrames: await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) })),
  };
  item.focusRestore = await focusFixtureTab(tabId);
  item.afterHostReturn = item.focusRestore.after;
  if (options.hotkeyAfterClose) {
    const ownerWindow = item.afterHostReturn?.windows?.find(window => window.id === item.focusRestore?.windowId);
    const focusVerified = item.afterHostReturn?.lastFocused?.focused === true && ownerWindow?.focused === true &&
      item.afterHostReturn?.tabActivity?.focused === true &&
      item.afterHostReturn?.activeCurrentWindow?.some(tab => tab.id === tabId && tab.active);
    if (!focusVerified) {
      item.hotkeyAfterClose = { attempted: false, skipped: true, reason: 'Dedicated browser window did not report focused=true after explicit window/tab activation.' };
    } else {
      const beforeKey = await readFixtureMedia(page);
      await page.keyboard.press('Shift+Period').catch(error => { item.hotkeyAfterCloseError = String(error?.message || error); });
      await sleep(350);
      const afterKey = await readFixtureMedia(page);
      const postKeyFrames = await apiFrames(tabId).catch(error => ({ error: String(error?.message || error) }));
      const postKeyMainApi = postKeyFrames.find(frame => frame.frameId === 0)?.result;
      const postKeyTarget = postKeyMainApi?.snapshot?.find(video => video.id === afterKey.main?.registryId) || null;
      const postKeyDiagnostic = postKeyMainApi?.diagnostics?.find(item => item.id === afterKey.main?.registryId) || null;
      const keyEvents = afterKey.keyEvents.slice(beforeKey.keyEvents.length);
      const trustedGreaterThanKeyup = keyEvents.some(event => event.type === 'keyup' && event.key === '>' && event.trusted);
      const commandApplied = postKeyDiagnostic?.rateOrigin === 'command' ||
        postKeyDiagnostic?.events?.some(event => event.kind === 'applied' && event.source === 'command');
      const toastMatchesRate = afterKey.toastText === Number(Number(afterKey.main?.rate).toFixed(2)).toString() + '×';
      item.hotkeyAfterClose = {
        attempted: true,
        trustedGreaterThanSeen: trustedGreaterThanKeyup,
        trustedGreaterThanKeyup,
        keyEvents,
        beforeRate: beforeKey.main?.rate ?? null,
        afterRate: afterKey.main?.rate ?? null,
        videoId: afterKey.main?.id ?? null,
        videoTitle: afterKey.main?.title ?? null,
        mainRegistryId: afterKey.main?.registryId || null,
        apiTarget: postKeyTarget ? { id: postKeyTarget.id, frameId: postKeyTarget.frameId,
          title: postKeyTarget.title, rate: postKeyTarget.rate } : null,
        rateOrigin: postKeyDiagnostic?.rateOrigin || null,
        commandApplied,
        apiDiagnostics: postKeyDiagnostic,
        toastText: afterKey.toastText,
        toastMatchesRate,
        changed: Math.abs(Number(afterKey.main?.rate) - Number(beforeKey.main?.rate)) > 0.001,
        focus: await browserState(tabId).catch(error => ({ error: String(error?.message || error) })),
      };
    }
  }
  item.analysis = analyzePopup(item);
  report.checkpoints.push(item);
  await saveReport();
  console.log(JSON.stringify({
    checkpoint: name,
    openedAt: item.openedAt,
    actualElapsedMs: item.actualElapsedMs,
    popupAction: item.toolbarPopup.action,
    popupDomAccessible: !!item.popup?.accessible,
    popupTitle: item.popup?.ui?.targetText || null,
    cachedTarget: item.analysis.cachedTarget,
    contentMediaCount: item.during.apiFrames?.flatMap(frame => frame.result?.snapshot || []).length ?? null,
    focusedWindow: item.during.focus?.lastFocused || null,
    tabActivity: item.during.focus?.tabActivity || null,
  }));
  return item;
}

function analyzePopup(item) {
  const dom = item.popup?.ui;
  const cache = item.popup?.cachedState;
  const videos = item.during?.apiFrames?.flatMap(frame => frame.result?.snapshot || []) || [];
  const videosBefore = item.before?.apiFrames?.flatMap(frame => frame.result?.snapshot || []) || [];
  const mainFrame = item.duringAfterPopupUi?.apiFrames?.find(frame => frame.frameId === 0)?.result ||
    item.before?.apiFrames?.find(frame => frame.frameId === 0)?.result;
  const mainVideo = mainFrame?.videoElements?.find(video => video.id === 'qa-main') || null;
  const mainApiVideo = mainFrame?.snapshot?.find(video => video.id === mainVideo?.registryId) || null;
  const expectedMainTitle = mainApiVideo?.title || mainVideo?.title || mainTitle;
  const highlightFrame = item.duringAfterPopupUi?.apiFrames?.find(frame => frame.frameId === 0)?.result;
  const highlight = highlightFrame?.highlight || null;
  const cacheTarget = cache?.target || null;
  const contentHasMedia = videos.length > 0;
  const contentHadMediaBeforePopup = videosBefore.length > 0;
  const titleMatchesMain = dom?.targetText === expectedMainTitle && cacheTarget?.title === expectedMainTitle;
  const cacheMatchesMain = !!mainVideo?.registryId && cacheTarget?.id === mainVideo.registryId && cacheTarget?.frameId === 0;
  const controllerReady = dom?.controlsHidden === false && dom?.playbackHidden === false &&
    dom?.rateDisabled === false && dom?.sliderDisabled === false && dom?.enabledDisabled === false &&
    (dom?.commandButtons?.length || 0) >= 4 && dom.commandButtons.every(button => button.disabled === false);
  const highlightMatchesMain = highlight?.title === expectedMainTitle && highlight?.overlapsMainVideo === true &&
    highlight?.box?.width > 0 && highlight?.box?.height > 0 && highlight?.border && highlight.border !== 'none';
  const popupHealthy = titleMatchesMain && cacheMatchesMain && controllerReady && highlightMatchesMain;
  const showsEmpty = dom?.targetText === 'No video found';
  return {
    contentHadMediaBeforePopup,
    contentHasMedia,
    mainVideo: mainVideo ? { id: mainVideo.id, registryId: mainVideo.registryId, title: mainVideo.title,
      apiTitle: mainApiVideo?.title || null, expectedTitle: expectedMainTitle, rate: mainVideo.rate } : null,
    cachedTarget: cacheTarget ? { id: cacheTarget.id, frameId: cacheTarget.frameId, title: cacheTarget.title, rate: cacheTarget.rate } : null,
    titleMatchesMain,
    cacheMatchesMain,
    controllerReady,
    highlight: highlight ? { title: highlight.title, border: highlight.border, overlapsMainVideo: highlight.overlapsMainVideo, box: highlight.box } : null,
    highlightMatchesMain,
    popupHealthy,
    popupShowsNoVideo: showsEmpty,
    suspectedPopupCacheDivergence: showsEmpty && (contentHasMedia || contentHadMediaBeforePopup) && !cacheTarget,
  };
}

async function readFixtureMedia(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#qa-main');
    const preview = document.querySelector('#qa-preview');
    return {
      title: document.title,
      main: main ? { id: main.id, title: main.getAttribute('data-video-title'), controls: main.controls,
        registryId: main.getAttribute('data-video-control-id'), rate: main.playbackRate, paused: main.paused, readyState: main.readyState } : null,
      preview: preview ? { id: preview.id, title: preview.getAttribute('data-video-title'),
        registryId: preview.getAttribute('data-video-control-id'), rate: preview.playbackRate, paused: preview.paused } : null,
      keyEvents: window.__qa?.keyEvents || [],
      toastText: document.querySelector('#video-control-toast')?.shadowRoot?.querySelector('span')?.textContent?.trim() || null,
    };
  });
}

async function createTrial(label, { child = false } = {}) {
  const url = qaSite === 'youtube'
    ? 'https://www.youtube.com/watch?v=QA082&fixture=local&trial=' + encodeURIComponent(label) + (child ? '&child=1' : '')
    : 'https://www.bilibili.com/video/BV1QA082?fixture=local&trial=' + encodeURIComponent(label) + (child ? '&child=1' : '');
  const newPage = context.waitForEvent('page', { timeout: 8000 });
  const tab = await workerCall(value => chrome.tabs.create({ url: value, active: true }), url);
  const page = await newPage;
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.bringToFront();
  const activeStart = new Date().toISOString();
  return { label, url, tabId: tab.id, page, activeStart, activeStartMs: Date.parse(activeStart) };
}

async function workerInstanceState() {
  const serviceWorker = currentWorker();
  if (!serviceWorker) return null;
  try {
    return await serviceWorker.evaluate(() => ({
      runtimeId: chrome.runtime.id,
      timeOrigin: performance.timeOrigin,
      observedAt: performance.now(),
    }));
  } catch (error) { return { error: String(error?.message || error) }; }
}

async function sendExtensionMessage(page, message) {
  return page.evaluate(payload => new Promise(resolve => {
    chrome.runtime.sendMessage({ scope: 'video-control', ...payload }, response => {
      resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : response);
    });
  }), message);
}

async function backgroundControlProbe(tabId) {
  const popupUrl = 'chrome-extension://' + extensionId + '/popup.html?qaAwayControl=' + tabId + '&nonce=' + Date.now();
  let targetId = null, page = null, response = null, error = null, startedAt = Date.now();
  try {
    const target = await cdp.send('Target.createTarget', { url: popupUrl, background: true });
    targetId = target.targetId;
    page = await waitFor(() => context.pages().find(candidate => candidate.url().startsWith(popupUrl)),
      'background control probe page did not load', 5000);
    await page.waitForSelector('#single-target', { timeout: 5000 });
    response = await sendExtensionMessage(page, { action: 'command', command: 'faster', tabId });
  } catch (problem) {
    error = String(problem?.message || problem);
  } finally {
    try { if (page && !page.isClosed()) await page.close(); } catch {}
    if (targetId) {
      try { await cdp.send('Target.closeTarget', { targetId }); } catch {}
    }
  }
  return {
    harnessOnly: true,
    sideEffectCapable: true,
    note: 'Background command is explicitly sent to the blurred fixture tab; success would change playback and fail the gate.',
    action: 'command:faster',
    targetTabId: tabId,
    senderPage: popupUrl,
    response,
    error,
    elapsedMs: Date.now() - startedAt,
  };
}

async function runReinjection(tabId, page) {
  const old = await workerCall(async id => {
    const rows = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const api = globalThis[Symbol.for('video-control.api')];
      const oldId = document.querySelector('#qa-main')?.getAttribute('data-video-control-id');
      api?.dispose?.();
      return { oldId, apiRemoved: !globalThis[Symbol.for('video-control.api')] };
    } });
    return rows?.[0]?.result || null;
  }, tabId);
  report.reinjection = { old, afterDispose: null, afterReinject: null, hotkey: null, popup: null };
  report.reinjection.afterDispose = await waitFor(() => workerCall(async id => {
    const rows = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => ({
      apiPresent: !!globalThis[Symbol.for('video-control.api')],
      registryId: document.querySelector('#qa-main')?.getAttribute('data-video-control-id'),
    }) });
    return rows?.[0]?.result?.apiPresent === false ? rows[0].result : null;
  }, tabId), 'dispose did not remove the main-frame API', 5000);
  await workerCall(async id => chrome.scripting.executeScript({
    injectImmediately: true, target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', files: ['content.js'],
  }), tabId);
  report.reinjection.afterReinject = await waitFor(() => workerCall(async ({ tabId: id, oldId }) => {
    const rows = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
      const api = globalThis[Symbol.for('video-control.api')];
      return { apiPresent: !!api, alive: !!api?.alive?.(), enabled: !!api?.enabled?.(),
        registryId: document.querySelector('#qa-main')?.getAttribute('data-video-control-id') };
    } });
    const value = rows?.[0]?.result;
    return value?.alive && value?.enabled && value?.registryId && value.registryId !== oldId ? value : null;
  }, { tabId, oldId: report.reinjection.old?.oldId }), 'same-document reinjection did not recover a live main-frame API', 10000);
  const before = await readFixtureMedia(page);
  await page.bringToFront();
  await page.keyboard.press('Shift+Period').catch(error => { report.reinjection.hotkeyError = String(error?.message || error); });
  await sleep(400);
  const after = await readFixtureMedia(page);
  report.reinjection.hotkey = {
    trustedKeySeen: after.keyEvents.slice(before.keyEvents.length).some(item => item.key === '>' && item.trusted),
    beforeRate: before.main?.rate, afterRate: after.main?.rate,
    changed: Math.abs(Number(after.main?.rate) - Number(before.main?.rate)) > 0.001,
    mainRegistryId: after.main?.registryId,
  };
  const opened = await openToolbarPopup('after-reinject');
  const inspection = await inspectToolbarTarget(opened, 'after-reinject');
  report.reinjection.popup = {
    action: opened.attempt,
    accessible: !!inspection.dom?.accessible,
    dom: inspection.dom,
    screenshot: inspection.screenshot,
  };
  await closeToolbarPopup(opened);
}

async function directMessageRace(tabId, diagnosticPopup) {
  const frames = await workerCall(async id => chrome.webNavigation.getAllFrames({ tabId: id }), tabId);
  const childFrame = frames.find(frame => frame.url.includes('/qa-embed'));
  if (!childFrame) return { attempted: false, reason: 'Bilibili-shaped child frame not found' };
  const setup = await workerCall(async ({ tabId: id, frameId }) => {
    const rows = await chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [frameId] }, world: 'ISOLATED',
      func: () => {
        const api = globalThis[Symbol.for('video-control.api')];
        if (!api?.alive?.()) return { installed: false, error: 'child content API not alive' };
        const original = api.refresh;
        const gate = { started: false, holding: true, release: null };
        api.refresh = async function (...args) {
          if (gate.holding) {
            gate.started = true;
            await new Promise(resolve => { gate.release = resolve; });
          }
          return Reflect.apply(original, this, args);
        };
        globalThis[Symbol.for('videospeed.qa-082.child-refresh-gate')] = gate;
        return { installed: true };
      },
    });
    return rows?.[0]?.result || { installed: false };
  }, { tabId, frameId: childFrame.frameId });
  if (!setup.installed) return { attempted: false, reason: setup.error || 'failed to install test-only child refresh gate' };
  const startedAt = Date.now();
  const delayed = sendExtensionMessage(diagnosticPopup, { action: 'getState', tabId, refresh: true });
  let gateState;
  try {
    gateState = await waitFor(() => workerCall(async ({ tabId: id, frameId }) => {
      const rows = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [frameId] }, world: 'ISOLATED',
        func: () => { const gate = globalThis[Symbol.for('videospeed.qa-082.child-refresh-gate')]; return { started: !!gate?.started, holding: !!gate?.holding }; } });
      return rows?.[0]?.result?.started ? rows[0].result : null;
    }, { tabId, frameId: childFrame.frameId }), 'full getState refresh did not enter the child delay', 5000);
  } catch (error) {
    return { attempted: true, installed: true, enteredGate: false, error: String(error?.message || error) };
  }
  const cachedAt = Date.now();
  const cached = await sendExtensionMessage(diagnosticPopup, { action: 'cachedState', tabId });
  const cachedCompletedAt = Date.now();
  const release = await workerCall(async ({ tabId: id, frameId }) => {
    const rows = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [frameId] }, world: 'ISOLATED',
      func: () => {
        const gate = globalThis[Symbol.for('videospeed.qa-082.child-refresh-gate')];
        if (!gate) return { installed: false };
        gate.holding = false; gate.release?.();
        return { installed: true, released: true };
      } });
    return rows?.[0]?.result;
  }, { tabId, frameId: childFrame.frameId });
  const refreshed = await delayed;
  const getStateCompletedAt = Date.now();
  return {
    attempted: true, harnessOnly: true, childFrameId: childFrame.frameId, childDocumentId: childFrame.documentId,
    gate: gateState, cachedState: cached, refreshedGetState: refreshed,
    order: { getStateStartedAt: startedAt, cachedStateStartedAt: cachedAt, cachedStateCompletedAt: cachedCompletedAt,
      getStateCompletedAt, cachedStateReturnedFirst: cachedCompletedAt < getStateCompletedAt },
    release, cachedTargetTitle: cached?.target?.title || null, refreshedTargetTitle: refreshed?.target?.title || null,
    interpretation: 'Both responses are recorded with the deliberate child refresh hold. This is not evidence of a production-site delay.',
  };
}

async function main() {
  await mkdir(output, { recursive: true });
  media = await readFile(fixturePath);
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  const actualHash = await runtimeHash();
  report.baseline.version = manifest.version;
  report.baseline.runtimeSha256 = actualHash;
  report.baseline.expectedVersion ||= manifest.version;
  report.baseline.expectedHash ||= actualHash;
  report.baseline.matched = (!expectedVersion || manifest.version === expectedVersion) &&
    (!expectedHash || actualHash === expectedHash);
  if (!report.baseline.matched) throw new Error('Refusing run: extension version/hash differs from the explicitly requested gate.');
  const executablePath = process.env.VIDEOSPEED_CHROMIUM?.trim() || chromium.executablePath();
  if (!path.isAbsolute(executablePath)) throw new Error('Chromium executable path must be absolute');
  await stat(executablePath);
  report.browser.executablePath = executablePath;
  report.browser.name = process.env.VIDEOSPEED_POPUP_BROWSER_NAME?.trim() ||
    (path.basename(executablePath).toLowerCase().includes('brave') ? 'Brave' : 'Chromium');
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'videospeed-popup-'));
  report.cleanup.temporaryProfileCreated = true;
  context = await chromium.launchPersistentContext(path.join(temporaryRoot, 'isolated-profile'), {
    executablePath,
    headless: false,
    viewport: { width: 1100, height: 900 },
    args: [
      '--disable-extensions-except=' + extension,
      '--load-extension=' + extension,
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1320,1040',
    ],
  });
  context.setDefaultTimeout(8000);
  context.on('page', page => page.on('pageerror', error => report.errors.push({ stage: 'pageerror', page: page.url(), message: String(error?.message || error) })));
  context.on('serviceworker', serviceWorker => {
    report.workerEvents ||= [];
    report.workerEvents.push({ at: new Date().toISOString(), url: serviceWorker.url() });
    worker = serviceWorker;
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = new URL(worker.url()).host;
  report.browser.version = context.browser()?.version() || 'unknown';
  cdp = await context.newCDPSession(context.pages()[0]);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return route.continue();
    if (!['http:', 'https:'].includes(url.protocol) ||
      !['www.bilibili.com', 'bilibili.com', 'www.youtube.com', 'youtube.com', 'example.test'].includes(url.hostname)) {
      report.fixture.blockedRequests = (report.fixture.blockedRequests || 0) + 1;
      report.fixture.lastBlockedUrl = url.origin + url.pathname;
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/qa-tiny.webm') return route.fulfill({
      status: 200, contentType: 'video/webm',
      headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body: media,
    });
    return route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      headers: { 'cache-control': 'no-store' }, body: fixture(url),
    });
  });
  const pages = context.pages();
  host = pages[0] || await context.newPage();
  await host.setViewportSize({ width: 1100, height: 900 });
  await worker.evaluate(value => chrome.storage.local.set({
    settings: value,
    lastRate: 1,
    lastRateRevision: 1,
    popupLanguage: 'en',
  }), settings);
  report.page = { url: fixtureBaseUrl, activeStart: null, tabId: null };
  const navigationStartedAt = Date.now();
  await host.goto(report.page.url, { waitUntil: 'domcontentloaded' });
  report.page.activeStart = new Date().toISOString();
  const tab = await waitFor(() => workerCall(async () => {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    return active?.id ? active : null;
  }), 'fixture did not become the active browser tab', 8000);
  report.page.tabId = tab.id;
  report.page.navigationToDomContentLoadedMs = Date.parse(report.page.activeStart) - navigationStartedAt;
  report.page.initialScreenshot = await saveShot(host, 'fixture-' + qaSite + '-main');
  report.page.fixtureMedia = await readFixtureMedia(host);

  const schedule = process.env.VIDEOSPEED_POPUP_HOTKEY_ONLY === '1' || process.env.VIDEOSPEED_POPUP_SMOKE === '1'
    ? [1000] : [1000, 5000, 12000, 35000];
  const firstLabel = schedule[0] / 1000 + 's-active';
  let sampleTrial = { label: firstLabel, page: host, tabId: tab.id, url: report.page.url, activeStart: report.page.activeStart };
  let trial35 = sampleTrial;
  for (let index = 0; index < schedule.length; index++) {
    const elapsedMs = schedule[index];
    if (index > 0) {
      sampleTrial = await createTrial((elapsedMs / 1000) + 's-independent');
      report.timepointTrials.push({
        label: sampleTrial.label, url: sampleTrial.url, tabId: sampleTrial.tabId,
        activeStart: sampleTrial.activeStart, activeStartMs: sampleTrial.activeStartMs,
        independentDocument: true, priorPopupWasClosed: true,
      });
    } else {
      report.timepointTrials.push({
        label: sampleTrial.label, url: sampleTrial.url, tabId: sampleTrial.tabId,
        activeStart: sampleTrial.activeStart, activeStartMs: Date.parse(sampleTrial.activeStart),
        independentDocument: true, priorPopupWasClosed: true,
      });
    }
    const targetAt = Date.parse(sampleTrial.activeStart) + elapsedMs;
    if (Date.now() < targetAt) await sleep(targetAt - Date.now());
    const checkpointName = elapsedMs / 1000 + 's-active';
    const item = await checkpoint(checkpointName, elapsedMs, sampleTrial.tabId, sampleTrial.page, sampleTrial.activeStart, {
      holdOpenMs: assertHealthy && (elapsedMs === 35000 || requestedPopupHoldMs > 0)
        ? requestedPopupHoldMs || 35000 : 0,
      hotkeyAfterClose: assertHealthy && (elapsedMs === 35000 || process.env.VIDEOSPEED_POPUP_HOTKEY_ONLY === '1' || process.env.VIDEOSPEED_POPUP_SMOKE === '1'),
    });
    report.timepointTrials[index].popup = item.analysis;
    report.timepointTrials[index].popupText = item.popup?.ui?.targetText || null;
    report.timepointTrials[index].prePopupFocus = item.before.focus;
    report.timepointTrials[index].prePopupApiFrames = item.before.apiFrames;
    if (assertHealthy) report.validation.checks.push({
      name: checkpointName,
      pass: item.analysis.popupHealthy,
      titleMatchesMain: item.analysis.titleMatchesMain,
      controllerReady: item.analysis.controllerReady,
      cacheMatchesMain: item.analysis.cacheMatchesMain,
      highlightMatchesMain: item.analysis.highlightMatchesMain,
      popupText: item.popup?.ui?.targetText || null,
      cachedTarget: item.analysis.cachedTarget,
      mainVideo: item.analysis.mainVideo,
      highlight: item.analysis.highlight,
    });
    if (assertHealthy && item.popupHold) {
      const heldApiMatchesMain = item.popupHold.samples.every(sample =>
        sample.snapshot?.some(video => video.id === sample.mainRegistryId && video.title === sample.mainTargetTitle));
      report.validation.checks.push({
        name: '35s-popup-held-open-and-controlled',
        pass: item.popupHold.persistent && item.popupHold.control.changed && heldApiMatchesMain,
        popupStayedConsistent: item.popupHold.persistent,
        popupCommandChangedMainRate: item.popupHold.control.changed,
        heldApiMatchesMain,
        heldMs: item.popupHold.heldMs,
        samples: item.popupHold.samples.map(sample => ({
          elapsedMs: sample.actualElapsedMs,
          title: sample.popup?.ui?.targetText || null,
          targetId: sample.popup?.cachedState?.target?.id || null,
          mainRegistryId: sample.mainRegistryId,
          mainTitle: sample.mainTargetTitle,
          rate: sample.mainRate,
        })),
      });
    }
    if (assertHealthy && item.hotkeyAfterClose) {
      const afterClose = item.hotkeyAfterClose;
      report.validation.checks.push({
        name: item.name + '-close-focus-and-trusted-hotkey',
        pass: item.afterHostReturn?.tabActivity?.focused === true &&
          item.afterHostReturn?.lastFocused?.focused === true && !!afterClose?.trustedGreaterThanKeyup &&
          afterClose?.changed === true && afterClose?.commandApplied === true && afterClose?.toastMatchesRate === true &&
          afterClose.videoId === 'qa-main' && afterClose.apiTarget?.id === afterClose.mainRegistryId &&
          afterClose.apiTarget?.title === afterClose.videoTitle && Number(afterClose.apiTarget?.rate) === Number(afterClose.afterRate),
        focusedAfterClose: item.afterHostReturn?.tabActivity?.focused ?? null,
        lastFocused: item.afterHostReturn?.lastFocused?.focused ?? null,
        actualWindowFocused: item.afterHostReturn?.windows?.find(window => window.id === item.focusRestore?.windowId)?.focused ?? null,
        focusWaitMs: item.focusRestore?.waitMs ?? null,
        trustedGreaterThanKeyup: afterClose?.trustedGreaterThanKeyup ?? false,
        changedMainRate: afterClose?.changed ?? false,
        commandApplied: afterClose?.commandApplied ?? false,
        rateOrigin: afterClose?.rateOrigin ?? null,
        toastMatchesRate: afterClose?.toastMatchesRate ?? false,
        beforeRate: afterClose?.beforeRate ?? null,
        afterRate: afterClose?.afterRate ?? null,
        mainVideoId: afterClose?.videoId || null,
        mainRegistryIdAfterPopupClose: afterClose?.mainRegistryId || null,
        apiTargetAfterHotkey: afterClose?.apiTarget || null,
      });
    }
    if (index === schedule.length - 1) trial35 = sampleTrial;
    await saveReport();
    if (!item.popup?.accessible) report.coverage.push('Toolbar popup DOM was not exposed at ' + item.name + '; its action call and browser target metadata were retained.');
  }

  const focusTrial = await createTrial('switch-away-return');
  const focusReady = await waitFor(async () => {
    const rows = await apiFrames(focusTrial.tabId);
    return rows.some(frame => frame.frameId === 0 && frame.result?.snapshot?.length > 0) ? rows : null;
  }, 'fresh focus-return fixture did not register its main video', 10000).catch(error => ({ error: String(error?.message || error) }));
  const beforeSwitch = {
    at: new Date().toISOString(),
    focus: await browserState(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) })),
    apiFrames: focusReady,
  };
  const away = await workerCall(async url => chrome.windows.create({ url, focused: true, type: 'normal', width: 800, height: 600 }), 'https://www.bilibili.com/qa-away');
  await sleep(450);
  const awayState = await browserState(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) }));
  const awayApis = await apiFrames(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) }));
  const awayKeyProbe = await runAwayHotkeyProbe(focusTrial.tabId, focusTrial.page).catch(error => ({
    blocked: false, error: String(error?.message || error),
  }));
  const focusRestore = await focusFixtureTab(focusTrial.tabId);
  await sleep(450);
  const returned = await browserState(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) }));
  const returnedApis = await apiFrames(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) }));
  const returnPopup = await checkpoint('switch-away-return', Date.now() - Date.parse(focusTrial.activeStart),
    focusTrial.tabId, focusTrial.page, focusTrial.activeStart);
  report.focusTransition = {
    awayWindowId: away?.id ?? null,
    awayWindowCreated: !!away?.id,
    beforeSwitch, awayState, awayApis, awayKeyProbe, focusRestore, returned, returnedApis,
    popupAfterReturn: returnPopup,
    awayWindowTabId: away?.tabs?.[0]?.id ?? null,
    note: 'This uses a new Bilibili-shaped document; it measures the away/return transition separately from earlier popup openings.',
  };
  if (assertHealthy) {
    const topAwayApi = awayApis.find(frame => frame.frameId === 0)?.result;
    const topReturnedApi = returnedApis.find(frame => frame.frameId === 0)?.result;
    const returnedMain = topReturnedApi?.videoElements?.find(video => video.id === 'qa-main');
    const returnedMainApi = topReturnedApi?.snapshot?.find(video => video.id === returnedMain?.registryId);
    report.validation.checks.push({
      name: 'switch-away-return-recovery',
      pass: awayState?.tabActivity?.focused === false &&
        awayKeyProbe?.blocked === true &&
        focusRestore?.request?.ok === true && returned?.lastFocused?.focused === true &&
        returned?.tabActivity?.focused === true && !!topReturnedApi?.alive && !!topReturnedApi?.enabled &&
        !!returnedMainApi && returnedMainApi.title === returnedMain?.title &&
        returnPopup.analysis?.popupHealthy === true,
      awayFocused: awayState?.tabActivity?.focused ?? null,
      awayWindowFocused: awayState?.lastFocused?.focused ?? null,
      awayApiEnabled: topAwayApi?.enabled ?? null,
      awaySnapshotCount: topAwayApi?.snapshot?.length ?? null,
      awayHotkeyProbe: awayKeyProbe,
      focusRestore: focusRestore?.request || null,
      focusRestoreVerified: returned?.lastFocused?.focused ?? null,
      returnedFocused: returned?.tabActivity?.focused ?? null,
      returnedApiAlive: topReturnedApi?.alive ?? null,
      returnedApiEnabled: topReturnedApi?.enabled ?? null,
      returnedSnapshotCount: topReturnedApi?.snapshot?.length ?? null,
      returnedMain: returnedMain ? { registryId: returnedMain.registryId, domTitle: returnedMain.title,
        apiTitle: returnedMainApi?.title || null } : null,
      popupAfterReturnHealthy: returnPopup.analysis?.popupHealthy ?? false,
    });
  }
  await saveShot(focusTrial.page, 'fixture-after-return');

  if (assertHealthy) {
    const noPopupTrial = await createTrial('no-popup-hotkey');
    report.noPopupHotkey = await runNoPopupHotkey(noPopupTrial.tabId, noPopupTrial.page);
    report.noPopupHotkey.tabId = noPopupTrial.tabId;
    report.validation.checks.push({
      name: 'trusted-hotkey-without-opening-popup',
      pass: report.noPopupHotkey.focusVerified && report.noPopupHotkey.trustedGreaterThanSeen &&
        report.noPopupHotkey.changed && report.noPopupHotkey.commandApplied && report.noPopupHotkey.toastMatchesRate &&
        report.noPopupHotkey.mainVideoId === 'qa-main' &&
        report.noPopupHotkey.apiTarget?.id === report.noPopupHotkey.mainRegistryId &&
        report.noPopupHotkey.apiTarget?.title === report.noPopupHotkey.mainTitle,
      focused: report.noPopupHotkey.focusVerified,
      trustedGreaterThanSeen: report.noPopupHotkey.trustedGreaterThanSeen,
      trustedGreaterThanKeyup: report.noPopupHotkey.trustedGreaterThanKeyup,
      changedMainRate: report.noPopupHotkey.changed,
      rateOrigin: report.noPopupHotkey.rateOrigin,
      commandApplied: report.noPopupHotkey.commandApplied,
      toastMatchesRate: report.noPopupHotkey.toastMatchesRate,
      focusWaitMs: report.noPopupHotkey.focusRestore.waitMs,
      beforeRate: report.noPopupHotkey.beforeRate,
      afterRate: report.noPopupHotkey.afterRate,
      mainVideoId: report.noPopupHotkey.mainVideoId,
      apiTarget: report.noPopupHotkey.apiTarget,
    });
  }

  const runExtraDiagnostics = !assertHealthy || process.env.VIDEOSPEED_POPUP_EXTRA_DIAGNOSTICS === '1';
  if (runExtraDiagnostics) {
    await trial35.page.bringToFront();
    const beforeKey = await readFixtureMedia(trial35.page);
    await trial35.page.keyboard.press('Shift+Period').catch(error => { report.errors.push({ stage: 'late-hotkey', message: String(error?.message || error) }); });
    await sleep(350);
    const afterKey = await readFixtureMedia(trial35.page);
    report.lateHotkey = {
      beforeRate: beforeKey.main?.rate, afterRate: afterKey.main?.rate,
      trustedGreaterThanSeen: afterKey.keyEvents.slice(beforeKey.keyEvents.length).some(item => item.key === '>' && item.trusted),
      changed: Math.abs(Number(afterKey.main?.rate) - Number(beforeKey.main?.rate)) > 0.001,
      fixtureMedia: afterKey,
      tabId: trial35.tabId,
    };

    await runReinjection(trial35.tabId, trial35.page);
  } else {
    report.lateHotkey = { skipped: true, reason: 'Strict gate covers popup-close and no-popup hotkeys; legacy extra diagnostic is omitted.' };
    report.reinjection = { skipped: true, reason: 'Reinjection is diagnostic only and is not part of the release gate.' };
  }

  if (runExtraDiagnostics) {
  const workerTargetsBefore = await targetInfos();
  const oldWorker = workerTargetsBefore.find(item => item.type === 'service_worker' && item.url.includes('/background.js'));
  report.workerRestart = {
    attempted: !!oldWorker, oldTargetId: oldWorker?.targetId || null, oldUrl: oldWorker?.url || null,
    before: await browserState(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) })),
    beforeInstance: await workerInstanceState(),
  };
  if (oldWorker) {
    try {
      const workerEvent = context.waitForEvent('serviceworker', { timeout: 12000 }).catch(() => null);
      const closeResult = await cdp.send('Target.closeTarget', { targetId: oldWorker.targetId });
      report.workerRestart.closeResult = closeResult;
      await focusTrial.page.bringToFront();
      await focusTrial.page.keyboard.press('Shift+Period').catch(() => {});
      const restarted = await workerEvent;
      if (!restarted) {
        const popup = await openToolbarPopup('after-worker-restart');
        const inspected = await inspectToolbarTarget(popup, 'after-worker-restart');
        report.workerRestart.wakePopup = { action: popup.attempt, accessible: !!inspected.dom?.accessible, dom: inspected.dom, screenshot: inspected.screenshot };
        await closeToolbarPopup(popup);
      }
      report.workerRestart.newWorkerUrl = restarted?.url() || currentWorker()?.url() || null;
      report.workerRestart.newTargetId = (await targetInfos()).find(item => item.type === 'service_worker' && item.url.includes('/background.js'))?.targetId || null;
      report.workerRestart.afterInstance = await workerInstanceState();
      report.workerRestart.confirmedByNewTimeOrigin = Number.isFinite(report.workerRestart.beforeInstance?.timeOrigin) &&
        Number.isFinite(report.workerRestart.afterInstance?.timeOrigin) &&
        report.workerRestart.beforeInstance.timeOrigin !== report.workerRestart.afterInstance.timeOrigin;
      report.workerRestart.after = await browserState(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) }));
      report.workerRestart.apiFrames = await apiFrames(focusTrial.tabId).catch(error => ({ error: String(error?.message || error) }));
      const popup = await openToolbarPopup('worker-restart-ui');
      const inspected = await inspectToolbarTarget(popup, 'worker-restart-ui');
      report.workerRestart.popup = {
        action: popup.attempt, accessible: !!inspected.dom?.accessible,
        dom: inspected.dom, screenshot: inspected.screenshot,
      };
      await closeToolbarPopup(popup);
    } catch (error) {
      report.workerRestart.error = String(error?.message || error);
    }
  } else {
    report.workerRestart.note = 'No service-worker Target was available to terminate; passive restart status is in workerEvents and checkpoint snapshots.';
  }

  let diagnosticPopup = null;
  try {
    const raceTrial = await createTrial('child-refresh', { child: true });
    report.delayedChildRefresh = { tabId: raceTrial.tabId, url: raceTrial.url, activeStart: raceTrial.activeStart };
    await waitFor(async () => {
      const rows = await apiFrames(raceTrial.tabId);
      return rows.some(frame => frame.frameId === 0 && frame.result?.snapshot?.length) &&
        rows.some(frame => frame.frameId > 0 && frame.result?.snapshot?.length) ? rows : null;
    }, 'child-refresh trial did not register both main and child media', 10000);
    const popupUrl = 'chrome-extension://' + extensionId + '/popup.html?qaWatchTab=' + raceTrial.tabId;
    await cdp.send('Target.createTarget', { url: popupUrl, background: true });
    diagnosticPopup = await waitFor(() => context.pages().find(page => page.url().startsWith(popupUrl)), 'diagnostic popup HTML target did not open');
    await diagnosticPopup.waitForSelector('#single-target');
    const initialized = await sendExtensionMessage(diagnosticPopup, { action: 'getState', tabId: raceTrial.tabId });
    const cachedBefore = await sendExtensionMessage(diagnosticPopup, { action: 'cachedState', tabId: raceTrial.tabId });
    const result = await directMessageRace(raceTrial.tabId, diagnosticPopup);
    report.delayedChildRefresh = { ...report.delayedChildRefresh, initialized, cachedBefore, ...result };
    if (result?.attempted && !result.enteredGate) report.coverage.push('Child refresh delay was installed but the refresh path did not reach it; the report contains the harness diagnostic.');
  } catch (error) {
    report.delayedChildRefresh = { attempted: false, error: String(error?.message || error) };
  } finally {
    await diagnosticPopup?.close().catch(() => {});
  }
  } else {
    report.workerRestart = { skipped: true, reason: 'Worker termination is diagnostic only and is not part of the release gate.' };
    report.delayedChildRefresh = { skipped: true, reason: 'Artificial delayed-child race is harness diagnostics only and is not part of the release gate.' };
  }

  const afterRuntimeHash = await runtimeHash();
  report.baseline.afterRuntimeSha256 = afterRuntimeHash;
  report.baseline.runtimeUnchanged = afterRuntimeHash === actualHash;
  const actualPopupSamples = report.checkpoints.filter(item => item.popup?.accessible);
  const divergences = report.checkpoints.filter(item => item.analysis?.suspectedPopupCacheDivergence);
  const popupDomFailures = report.checkpoints.filter(item => item.popup?.accessible &&
    (!item.analysis?.popupHealthy || item.analysis?.popupShowsNoVideo));
  const contentTargets = report.checkpoints.flatMap(item => item.analysis?.contentHasMedia ? [item.name] : []);
  report.summary = {
    timepointSamples: report.checkpoints.filter(item => item.name.endsWith('s-active')).length,
    actualToolbarPopupDomSamples: actualPopupSamples.length,
    contentHadMediaAt: contentTargets,
    suspectedCacheDivergenceAt: divergences.map(item => item.name),
    popupDomFailureAt: popupDomFailures.map(item => item.name),
    lateHotkey: report.lateHotkey,
    postReinjectHotkey: report.reinjection?.hotkey || null,
    workerRestarted: !!report.workerRestart?.newTargetId &&
      report.workerRestart.newTargetId !== report.workerRestart.oldTargetId,
    workerEvents: report.workerEvents || [],
  };
  if (assertHealthy) {
    report.validation.runtimeIntegrity = {
      requestedVersionMatched: report.baseline.matched,
      unchangedFromStart: report.baseline.runtimeUnchanged,
      beforeSha256: actualHash,
      afterSha256: afterRuntimeHash,
    };
    const expectedChecks = schedule.length + 3 + (report.checkpoints.some(item => item.popupHold) ? 1 : 0);
    report.validation.passed = report.validation.checks.length >= expectedChecks &&
      report.validation.checks.every(check => check.pass === true) &&
      report.validation.runtimeIntegrity.requestedVersionMatched &&
      report.validation.runtimeIntegrity.unchangedFromStart;
    report.validation.failedChecks = report.validation.checks.filter(check => !check.pass).map(check => check.name);
  }
  const reproduced = divergences.length > 0 ||
    (report.checkpoints.some(item => item.name === '35s-active' && item.popup?.accessible &&
      item.analysis?.popupShowsNoVideo && item.analysis?.contentHasMedia));
  report.result = reproduced ? 'REPRODUCED' : actualPopupSamples.length >= 1 ? 'NOT_REPRODUCED' : 'INCONCLUSIVE';
}

let fatalError;
try {
  await main();
} catch (error) {
  fatalError = error;
  report.errors.push({ stage: 'fatal', message: String(error?.stack || error?.message || error) });
} finally {
  await context?.close().catch(error => { fatalError ||= error; });
  if (cdp) await cdp.detach().catch(() => {});
  if (temporaryRoot) {
    const resolved = await realpath(temporaryRoot).catch(() => path.resolve(temporaryRoot));
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith('videospeed-popup-')) {
      await rm(resolved, { recursive: true, force: true }).then(() => { report.cleanup.temporaryProfileRemoved = true; })
        .catch(error => { report.cleanup.error = String(error?.message || error); fatalError ||= error; });
    } else {
      report.cleanup.error = 'Refused to remove a profile outside this run temporary directory.';
      fatalError ||= new Error(report.cleanup.error);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.fatalError = fatalError ? String(fatalError?.stack || fatalError?.message || fatalError) : null;
  await mkdir(output, { recursive: true }).catch(() => {});
  await mkdir(qaDirectory, { recursive: true }).catch(() => {});
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8').catch(() => {});
}

console.log(JSON.stringify({
  result: report.result,
  version: report.baseline.version,
  runtimeSha256: report.baseline.runtimeSha256,
  browser: report.browser.version,
  timepoints: report.summary?.timepointSamples ?? report.checkpoints.length,
  toolbarPopupDomSamples: report.summary?.actualToolbarPopupDomSamples ?? 0,
  suspectedCacheDivergenceAt: report.summary?.suspectedCacheDivergenceAt ?? [],
  validation: report.validation,
  lateHotkey: report.lateHotkey || null,
  report: reportPath,
  fatalError: report.fatalError,
}, null, 2));
if (fatalError || (assertHealthy && report.validation.passed !== true)) process.exitCode = 1;
