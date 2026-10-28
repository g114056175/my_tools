#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const value = process.env.VIDEOSPEED_PLAYWRIGHT?.trim();
  return value ? require(path.resolve(value)) : require('playwright');
}
const { chromium } = loadPlaywright();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '../..');
const workDir = path.join(projectRoot, 'work', 'qa-077-slow-load');
const fixturePath = path.join(projectRoot, 'tests', 'fixtures', 'tiny.webm');
const mode = process.argv[2] || 'candidate';
assert.ok(['baseline', 'candidate'].includes(mode), 'mode must be baseline or candidate');
const browserLabel = (process.env.VIDEOSPEED_BROWSER_LABEL?.trim() ||
  (/brave/iu.test(process.env.VIDEOSPEED_CHROMIUM || '') ? 'brave' : 'chromium')).toLowerCase().replace(/[^a-z0-9-]/gu, '-');
const extensionDir = mode === 'baseline'
  ? path.join(workDir, 'baseline-extension')
  : path.join(projectRoot, 'extension');
const outputPath = path.join(workDir, mode === 'baseline' ? 'baseline.json' : `candidate-${browserLabel}.json`);
const SETTINGS = {
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
const CASES = [
  { name: 'known-video-play-at-15s', kind: 'known' },
  { name: 'video-inserted-at-15s', kind: 'empty' },
  { name: 'new-background-tab-from-opener', kind: 'known' },
  { name: 'youtube-ad-unblocks-at-15s', kind: 'ad' },
  { name: 'open-shadow-video-at-15s', kind: 'shadow' },
];
const report = {
  mode, browserLabel, startedAt: new Date().toISOString(), extensionDir, extensionVersion: null, runtimeSha256: null,
  chromium: null, chromiumExecutable: null, extensionId: null, fixture: null, checks: [],
  blockedExternalRequests: [], servedFixtureRequests: [], cleanup: { profileCreated: false, profileRemoved: false, verifiedInsideOsTemp: false, error: null },
  errors: [],
};
const blockedExternalRequests = new Set();
let fixtureServer, context, serviceWorker, profileRoot, fixturePort, fixtureUrlBase;

function record(name, status, detail = '') {
  report.checks.push({ name, status, detail: String(detail || '').replace(/\s+/gu, ' ').trim() });
}

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try { const value = await predicate(); if (value) return value; }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message + (lastError ? ': ' + lastError.message : ''));
}

async function allFiles(root, relative = '') {
  const result = [];
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.posix.join(relative.replaceAll('\\', '/'), item.name);
    if (item.isDirectory()) result.push(...await allFiles(root, child));
    else if (item.isFile()) result.push(child);
  }
  return result.sort();
}

async function extensionDigest(root) {
  const files = await allFiles(root);
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
  return { hash: hash.digest('hex'), files };
}

function fixtureHtml(url) {
  const caseName = url.searchParams.get('case') || 'fixture';
  const routeId = url.searchParams.get('v') || caseName;
  const empty = url.searchParams.get('empty') === '1';
  const ad = url.searchParams.get('ad') === '1';
  const styles = '<style>html,body{margin:0;background:#111;color:#fff}#movie_player{width:640px;height:360px;position:relative;background:#000}.html5-main-video{width:100%;height:100%;display:block}#status{font:14px sans-serif}</style>';
  const video = empty ? '' : '<video class="html5-main-video" muted loop playsinline controls src="/tiny.webm?case=' + encodeURIComponent(caseName) + '"></video>';
  const setup = `(()=>{
    const player=document.querySelector('#movie_player');
    const routeId=${JSON.stringify(routeId)};
    const stats={qualityReads:0,qualitySetters:[]};
    player.getVideoData=()=>({video_id:routeId,title:'VideoSpeed fixture '+routeId});
    player.getPlayerResponse=()=>({videoDetails:{videoId:routeId}});
    player.getAvailableQualityLevels=()=>{stats.qualityReads++;return ['hd720','hd1080']};
    player.setPlaybackQualityRange=(min,max)=>{stats.qualitySetters.push([min,max])};
    player.setPlaybackQuality=quality=>{stats.qualitySetters.push([quality,quality])};
    const insert=()=>{
      let v=player.querySelector('video.html5-main-video');
      if(v)return v;
      v=document.createElement('video');v.className='html5-main-video';v.muted=true;v.loop=true;v.playsInline=true;v.controls=true;
      v.src='/tiny.webm?case='+encodeURIComponent(${JSON.stringify(caseName)});player.append(v);return v;
    };
    window.__qaSlowLoad={player,stats,routeId,insert,async play(){const v=insert();try{await v.play()}catch{}return v},async addOpenShadowVideo(){
      const host=document.createElement('div');host.id='late-shadow-host';player.append(host);const root=host.attachShadow({mode:'open'});
      const v=document.createElement('video');v.className='html5-main-video';v.muted=true;v.loop=true;v.playsInline=true;v.controls=true;v.src='/tiny.webm?case='+encodeURIComponent(${JSON.stringify(caseName)});root.append(v);
      try{await v.play()}catch{}return v;
    },async unblockAd(){player.classList.remove('ad-showing');const v=insert();try{await v.play()}catch{}return v}};
  })();`;
  return '<!doctype html><html><head><meta charset="utf-8"><title>VideoSpeed delayed YouTube fixture</title>' + styles +
    '</head><body><main id="movie_player" class="html5-video-player' + (ad ? ' ad-showing' : '') + '">' + video + '</main>' +
    '<div id="status">' + caseName + '</div><script>' + setup + '</script></body></html>';
}

async function startServer(mediaBytes) {
  fixtureServer = createServer((request, response) => {
    const url = new URL(request.url || '/', fixtureUrlBase || 'http://127.0.0.1');
    report.servedFixtureRequests.push({ path: url.pathname, query: url.search });
    if (url.pathname === '/tiny.webm') {
      const range = /^bytes=(\d+)-(\d*)$/u.exec(String(request.headers.range || ''));
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : mediaBytes.length - 1, mediaBytes.length - 1);
        response.writeHead(206, { 'content-type': 'video/webm', 'cache-control': 'no-store', 'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${mediaBytes.length}`, 'content-length': String(Math.max(0, end - start + 1)) });
        response.end(mediaBytes.subarray(start, end + 1));
      } else {
        response.writeHead(200, { 'content-type': 'video/webm', 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'content-length': String(mediaBytes.length) });
        response.end(mediaBytes);
      }
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(fixtureHtml(url));
  });
  await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(0, '127.0.0.1', resolve); });
  fixturePort = fixtureServer.address().port;
  fixtureUrlBase = `http://www.youtube.com:${fixturePort}`;
  report.fixture = { origin: fixtureUrlBase, routeHost: 'www.youtube.com', localServer: '127.0.0.1', mediaBytes: mediaBytes.length,
    actualTinyWebm: true, getVideoDataMatchesRoute: true, getPlayerResponseMatchesRoute: true };
}

async function worker() {
  if (serviceWorker?.url().includes(`chrome-extension://${report.extensionId}/`)) return serviceWorker;
  serviceWorker = context.serviceWorkers().find(item => item.url().includes(`chrome-extension://${report.extensionId}/`));
  if (serviceWorker) return serviceWorker;
  serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return serviceWorker;
}

async function seedSettings(patch = {}, memory = {}) {
  const sw = await worker();
  await sw.evaluate(({ settings, memory }) => chrome.storage.local.set({ settings, ...memory }), { settings: { ...SETTINGS, ...patch }, memory });
}

async function storedRatePair() {
  return (await worker()).evaluate(async () => {
    const { lastRate, lastRateRevision } = await chrome.storage.local.get(['lastRate', 'lastRateRevision']);
    return { lastRate, lastRateRevision };
  });
}

async function contentRateMemory(tabId) {
  const rows = await (await worker()).evaluate(id => chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
    const api = globalThis[Symbol.for('video-control.api')];
    return api?.diagnostics?.()?.[0]?.memory || null;
  } }), tabId);
  return rows?.[0]?.result || null;
}

async function chromeTabs() {
  return (await worker()).evaluate(() => chrome.tabs.query({}));
}

async function tabInfo(tabId) {
  return (await worker()).evaluate(id => chrome.tabs.get(id), tabId);
}

async function activitySnapshot() {
  return (await worker()).evaluate(async () => chrome.storage.session.get('tabActivity'));
}

async function createTab({ name, active = false, openerTabId, kind = 'known', routeId }) {
  const params = new URLSearchParams({ case: name, v: routeId || name });
  if (kind === 'empty') params.set('empty', '1');
  if (kind === 'ad') params.set('ad', '1');
  const url = `${fixtureUrlBase}/watch?${params}`;
  const sw = await worker();
  const createdAt = Date.now();
  const tab = await sw.evaluate(options => chrome.tabs.create(options), {
    url, active, ...(Number.isInteger(openerTabId) ? { openerTabId } : {}),
  });
  const page = await waitFor(() => context.pages().find(item => item.url() === url), `fixture page not attached: ${name}`, 15_000);
  await waitFor(async () => (await tabInfo(tab.id)).status === 'complete', `fixture tab not complete: ${name}`, 20_000);
  await page.waitForFunction(() => !!window.__qaSlowLoad, null, { timeout: 10_000 });
  return { name, kind, url, page, tab, createdAt };
}

async function openBackgroundChildFrom(opener, { name, kind = 'known', routeId }) {
  const params = new URLSearchParams({ case: name, v: routeId || name });
  if (kind === 'empty') params.set('empty', '1');
  if (kind === 'ad') params.set('ad', '1');
  const url = `${fixtureUrlBase}/watch?${params}`;
  const linkId = 'qa-child-' + name.replace(/[^a-z0-9-]/giu, '-');
  await opener.page.evaluate(({ id, href }) => {
    const anchor = document.createElement('a'); anchor.id = id; anchor.href = href; anchor.target = '_blank';
    anchor.textContent = id; document.body.append(anchor);
  }, { id: linkId, href: url });
  const createdAt = Date.now();
  await opener.page.locator('#' + linkId).click({ button: 'middle', noWaitAfter: true });
  const page = await waitFor(() => context.pages().find(item => item.url() === url), `background child did not open: ${name}`, 15_000);
  const tab = await waitFor(async () => {
    const rows = await chromeTabs();
    const item = rows.find(row => row.url === url);
    return item?.id ? item : null;
  }, `background child tab is missing: ${name}`, 15_000);
  await waitFor(async () => (await tabInfo(tab.id)).status === 'complete', `background child did not complete: ${name}`, 20_000);
  await page.waitForFunction(() => !!window.__qaSlowLoad, null, { timeout: 10_000 });
  assert.equal(tab.active, false, `${name} middle-click did not create an inactive tab`);
  assert.equal(tab.openerTabId, opener.tab.id, `${name} does not name the active opener`);
  return { name, kind, url, page, tab, createdAt };
}

async function activate(tabId) {
  await (await worker()).evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
  await waitFor(async () => (await tabInfo(tabId)).active === true, `tab did not become active: ${tabId}`);
}

async function closeTab(tabId) {
  await (await worker()).evaluate(id => chrome.tabs.remove(id), tabId).catch(() => {});
}

async function pageVideoState(page, selector = '#movie_player video.html5-main-video') {
  return page.evaluate(selectorValue => {
    const video = selectorValue === '__shadow__'
      ? document.querySelector('#late-shadow-host')?.shadowRoot?.querySelector('video.html5-main-video')
      : document.querySelector(selectorValue);
    return video ? {
      rate: video.playbackRate, defaultRate: video.defaultPlaybackRate,
      marker: video.getAttribute('data-video-control-id'), initialized: video.getAttribute('data-video-control-initialized'),
      ready: video.getAttribute('data-video-control-ready'), readyKey: video.getAttribute('data-video-control-ready-key'),
      paused: video.paused, readyState: video.readyState, currentTime: video.currentTime,
    } : null;
  }, selector);
}

async function pageQualityState(page) {
  return page.evaluate(() => ({ reads: window.__qaSlowLoad?.stats.qualityReads ?? -1,
    setters: window.__qaSlowLoad?.stats.qualitySetters.length ?? -1,
    qualitySetters: window.__qaSlowLoad?.stats.qualitySetters ?? [] }));
}

async function contentState(tabId) {
  const rows = await (await worker()).evaluate(id => chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, world: 'ISOLATED', func: () => {
    const api = globalThis[Symbol.for('video-control.api')];
    return { present: !!api, alive: !!api?.alive?.(), session: !!api?.enabled?.() };
  } }), tabId);
  return rows?.[0]?.result || null;
}

const PROBE_KEY = 'videospeed.qa-077.slow-load.dom-probe';
async function installDomProbe(tabId) {
  return (await worker()).evaluate(({ tabId, key }) => chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [key], func: probeName => {
      const symbol = Symbol.for(probeName);
      if (globalThis[symbol]) return true;
      const state = { documentWalkerCalls: 0, shadowTreeWalkerCalls: 0, documentVideoQueries: 0, shadowVideoQueries: 0 };
      globalThis[symbol] = state;
      const originalWalker = Document.prototype.createTreeWalker;
      Document.prototype.createTreeWalker = function (...args) {
        if (this === document && args[0] === document) state.documentWalkerCalls++;
        else if (args[0]?.nodeType === 11) state.shadowTreeWalkerCalls++;
        return Reflect.apply(originalWalker, this, args);
      };
      const originalQuery = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function (selector, ...args) {
        if (this === document && /(?:^|[,\s])video(?:$|[,\s])/iu.test(String(selector))) state.documentVideoQueries++;
        return Reflect.apply(originalQuery, this, [selector, ...args]);
      };
      const originalFragmentQuery = DocumentFragment.prototype.querySelectorAll;
      if (originalFragmentQuery) DocumentFragment.prototype.querySelectorAll = function (selector, ...args) {
        if (this.nodeType === 11 && /(?:^|[,\s])video(?:$|[,\s])/iu.test(String(selector))) state.shadowVideoQueries++;
        return Reflect.apply(originalFragmentQuery, this, [selector, ...args]);
      };
      return true;
    },
  }), { tabId, key: PROBE_KEY });
}

async function readDomProbe(tabId) {
  const rows = await (await worker()).evaluate(({ tabId, key }) => chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [key], func: probeName => ({ ...globalThis[Symbol.for(probeName)] }),
  }), { tabId, key: PROBE_KEY });
  return rows?.[0]?.result || { documentWalkerCalls: 0, shadowTreeWalkerCalls: 0, documentVideoQueries: 0, shadowVideoQueries: 0 };
}

async function waitProbeQuiet(tabId) {
  let previous = JSON.stringify(await readDomProbe(tabId)), quiet = 0;
  while (quiet < 3) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const current = JSON.stringify(await readDomProbe(tabId));
    if (current === previous) quiet++;
    else { previous = current; quiet = 0; }
  }
  return JSON.parse(previous);
}

async function playMain(item) {
  return item.page.evaluate(() => window.__qaSlowLoad.play());
}

async function lateAction(item) {
  if (item.kind === 'empty') return item.page.evaluate(() => window.__qaSlowLoad.play());
  if (item.kind === 'ad') return item.page.evaluate(() => window.__qaSlowLoad.unblockAd());
  if (item.kind === 'shadow') return item.page.evaluate(() => window.__qaSlowLoad.addOpenShadowVideo());
  return playMain(item);
}

async function assertLateOutcome(item, expectApply, probeBefore) {
  const expectQuality = expectApply && item.kind !== 'shadow';
  const expectedRate = expectApply ? 8 : 1;
  let rateState;
  if (expectApply) {
    rateState = await waitFor(async () => {
      const state = await pageVideoState(item.page, item.kind === 'shadow' ? '__shadow__' : '#movie_player video.html5-main-video');
      return state && Math.abs(state.rate - expectedRate) < 0.011 && Math.abs(state.defaultRate - expectedRate) < 0.011 ? state : null;
    }, `${item.name} did not apply initial default rate ${expectedRate}`, 12_000);
    if (expectQuality) await waitFor(async () => (await pageQualityState(item.page)).setters > 0,
      `${item.name} did not request YouTube quality`, 12_000);
  } else {
    await new Promise(resolve => setTimeout(resolve, 800));
    rateState = await pageVideoState(item.page, item.kind === 'shadow' ? '__shadow__' : '#movie_player video.html5-main-video');
  }
  const quality = await pageQualityState(item.page);
  const probeAfter = await waitProbeQuiet(item.tab.id);
  const domScanDelta = Object.fromEntries(Object.keys(probeBefore).map(key => [key, probeAfter[key] - probeBefore[key]]));
  assert.ok(rateState, `${item.name} did not create its expected main video`);
  assert.ok(Math.abs(rateState.rate - expectedRate) < 0.011, `${item.name} rate ${rateState.rate} != ${expectedRate}`);
  if (expectApply) {
    assert.ok(Math.abs(rateState.defaultRate - expectedRate) < 0.011, `${item.name} defaultRate ${rateState.defaultRate} != ${expectedRate}`);
    if (expectQuality) assert.ok(quality.setters > 0, `${item.name} has no quality setter call`);
  } else {
    assert.equal(quality.setters, 0, `${item.name} unexpectedly called quality setter`);
  }
  assert.ok(Object.values(domScanDelta).every(value => value === 0), `${item.name} performed a DOM tree scan after the 10s activity grace: ${JSON.stringify(domScanDelta)}`);
  return { name: item.name, kind: item.kind, tabId: item.tab.id, createdAt: item.createdAt,
    atActionMs: Date.now() - item.createdAt, rate: rateState.rate, defaultRate: rateState.defaultRate,
    marker: rateState.marker, initialized: rateState.initialized, ready: rateState.ready,
    paused: rateState.paused, readyState: rateState.readyState, qualitySetters: quality.setters,
    qualityCalls: quality.qualitySetters, domScanDelta, expectedApplied: expectApply, expectedQuality: expectQuality };
}

async function waitUntil(timestamp) {
  const ms = Math.max(0, timestamp - Date.now());
  if (ms) await new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
try {
  await mkdir(workDir, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
  report.extensionVersion = manifest.version;
  const digest = await extensionDigest(extensionDir);
  report.runtimeSha256 = digest.hash;
  report.runtimeFiles = digest.files.length;
  assert.equal(manifest.name, 'VideoSpeed');
  if (mode === 'baseline') assert.equal(manifest.version, '0.6.14', 'baseline copy must stay at 0.6.14');
  await stat(fixturePath);
  const requested = process.env.VIDEOSPEED_CHROMIUM?.trim();
  const chromiumPath = requested || chromium.executablePath();
  assert.ok(path.isAbsolute(chromiumPath), 'Chromium executable path must be absolute');
  await stat(chromiumPath);
  report.chromiumExecutable = chromiumPath;
  await startServer(await readFile(fixturePath));
  profileRoot = await mkdtemp(path.join(os.tmpdir(), 'videospeed-qa077-'));
  report.cleanup.profileCreated = true;
  const profile = path.join(profileRoot, 'profile');
  context = await chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath, headless: true, ignoreHTTPSErrors: true,ignoreDefaultArgs:['--disable-extensions','--headless'],
    viewport: { width: 1100, height: 800 },
    args: [
      '--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir,
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--headless=new','--autoplay-policy=no-user-gesture-required',
      '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    ],
  });
  context.setDefaultTimeout(12_000);
  context.on('page', page => page.on('pageerror', error => report.errors.push({ url: page.url(), message: error.message })));
  await context.route('**/*', async route => {
    let url; try { url = new URL(route.request().url()); } catch { return route.abort('blockedbyclient'); }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return route.continue();
    if (url.hostname === 'www.youtube.com' && Number(url.port) === fixturePort) return route.continue();
    if (url.protocol === 'http:' || url.protocol === 'https:') blockedExternalRequests.add(`${url.protocol}//${url.host}`);
    return route.abort('blockedbyclient');
  });
  context.on('request', request => {
    let url; try { url = new URL(request.url()); } catch { blockedExternalRequests.add(request.url()); return; }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return;
    if (url.hostname === 'www.youtube.com' && Number(url.port) === fixturePort) return;
    if (url.protocol === 'http:' || url.protocol === 'https:') blockedExternalRequests.add(`${url.protocol}//${url.host}`);
  });
  report.chromium = context.browser()?.version() || 'unknown';
  serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15_000 });
  report.extensionId = new URL(serviceWorker.url()).host;
  const originalRatePair = await waitFor(async () => {
    const pair = await storedRatePair();
    return typeof pair.lastRate === 'number' && Number.isFinite(pair.lastRate) &&
      Number.isSafeInteger(pair.lastRateRevision) && pair.lastRateRevision >= 0 ? pair : null;
  }, 'background did not initialize its original lastRateRevision');
  const initialRatePair = { lastRate: 1, lastRateRevision: originalRatePair.lastRateRevision + 1 };
  report.initialRatePair = { original: originalRatePair, seeded: initialRatePair };
  await seedSettings({}, initialRatePair);
  const initializedPair = await waitFor(async () => {
    const pair = await storedRatePair();
    return pair.lastRate === initialRatePair.lastRate && pair.lastRateRevision === initialRatePair.lastRateRevision ? pair : null;
  }, 'initial lastRate/lastRateRevision pair did not persist');
  report.initialRatePair.persisted = { ...initializedPair, verifiedBeforePages: true };

  const anchor = await createTab({ name: 'active-opener', active: true, kind: 'known' });
  await waitFor(async () => {
    const api = await contentState(anchor.tab.id), memory = await contentRateMemory(anchor.tab.id);
    return api?.session && memory?.revision === initializedPair.lastRateRevision ? { api, memory } : null;
  }, 'active opener content did not acknowledge the initialized initial-rate revision');
  report.initialRatePair.contentAcknowledgedRevision = (await contentRateMemory(anchor.tab.id))?.revision ?? null;
  const known = await createTab({ name: 'known-video-play-at-15s', active: true, openerTabId: anchor.tab.id, kind: 'known' });
  const knownBlurAt = Date.now();
  await activate(anchor.tab.id);
  known.deactivatedAt = knownBlurAt;
  const cases = [known];
  for (const item of CASES.slice(1)) cases.push(await openBackgroundChildFrom(anchor, item));

  const noVideoExpiry = await openBackgroundChildFrom(anchor, { name: 'unseen-video-after-60s', kind: 'empty' });
  const caseTabs = [...cases, noVideoExpiry];
  let latestSnapshot = null, latestTabs = null;
  let beforeGrace;
  try {
    beforeGrace = await waitFor(async () => {
      latestSnapshot = await activitySnapshot();
      latestTabs = await chromeTabs();
      const leases = caseTabs.map(item => latestSnapshot.tabActivity?.untilByTab?.[item.tab.id] || 0);
      return leases.every(until => until > Date.now()) ? latestSnapshot : null;
    }, 'recent tab activity leases were not persisted', 10_000);
  } catch (error) {
    report.activityDebug = { latestSnapshot, tabs: latestTabs, fixtureTabs: caseTabs.map(item => ({ name: item.name, id: item.tab.id,
      openerTabId: item.tab.openerTabId ?? null, windowId: item.tab.windowId, createdAt: item.createdAt })) };
    throw new Error(error.message + '; debug=' + JSON.stringify(report.activityDebug));
  }
  const deadlines = Object.fromEntries(caseTabs.map(item => [item.name, beforeGrace.tabActivity?.untilByTab?.[item.tab.id] || 0]));
  for (const item of caseTabs) assert.ok(deadlines[item.name] > Date.now(), `${item.name} did not receive real tab activity grace`);
  const latestTenSecondDeadline = Math.max(...Object.values(deadlines));
  report.activityLeases = caseTabs.map(item => ({ name: item.name, tabId: item.tab.id, deadline: deadlines[item.name],
    grant: item.name === known.name ? 'active-tab blur' : 'inactive child tab with active opener' }));

  const initialChrome = await (await worker()).evaluate(async () => {
    const [window, tabs] = await Promise.all([chrome.windows.getLastFocused(), chrome.tabs.query({ active: true, lastFocusedWindow: true })]);
    return { focused: window?.focused === true, windowId: window?.id ?? null, activeTabId: tabs[0]?.id ?? null };
  });
  assert.equal(initialChrome.focused, true, 'Chromium fixture window is not focused');
  assert.equal(initialChrome.activeTabId, anchor.tab.id, 'active opener was not kept active');
  for (const item of caseTabs) {
    const info = await tabInfo(item.tab.id);
    assert.equal(info.active, false, `${item.name} is not an actual background tab`);
    assert.equal(info.windowId, anchor.tab.windowId, `${item.name} opened in another window`);
  }

  await waitUntil(latestTenSecondDeadline + 250);
  const postGraceApi = {};
  for (const item of caseTabs) {
    postGraceApi[item.name] = await contentState(item.tab.id);
    await installDomProbe(item.tab.id);
  }
  const probesBefore = {};
  for (const item of caseTabs) probesBefore[item.name] = await waitProbeQuiet(item.tab.id);
  report.postGrace = { at: new Date().toISOString(), activityApi: postGraceApi, domProbe: probesBefore };
  for (const item of cases) {
    const api = postGraceApi[item.name];
    assert.ok(api?.alive, `${item.name} content api is missing after activity expiry`);
    if (mode === 'baseline') assert.equal(api.session, false, `${item.name} baseline session unexpectedly survived 10s`);
    else assert.equal(api.session, true, `${item.name} candidate did not keep its pending initializer session after 10s`);
  }
  if (mode === 'candidate') assert.equal(postGraceApi[noVideoExpiry.name]?.session, true, 'candidate did not keep the no-video pending initializer before its 60s deadline');

  await Promise.all(cases.map(async item => {
    const graceStartedAt = item.deactivatedAt || item.createdAt;
    await waitUntil(graceStartedAt + 15_000);
    item.actionAt = Date.now();
    await lateAction(item);
    item.realPlayback = await waitFor(async () => {
      const state = await pageVideoState(item.page, item.kind === 'shadow' ? '__shadow__' : '#movie_player video.html5-main-video');
      return state && !state.paused && state.readyState >= 2 && state.currentTime > 0 ? state : null;
    }, `${item.name} fixture media did not really enter playing state`, 10_000);
  }));
  const lateOutcomes = [];
  for (const item of cases) {
    const expectApply = mode === 'candidate';
    const outcome = await assertLateOutcome(item, expectApply, probesBefore[item.name]);
    lateOutcomes.push(outcome);
    report.lateOutcomes = [...lateOutcomes];
  }
  report.lateOutcomes = lateOutcomes;
  record('逾 10 秒後的 YouTube 媒體事件處理', 'PASS', lateOutcomes.map(item =>
    `${item.name}: ${item.rate}x, quality setters ${item.qualitySetters}, DOM scan Δ ${JSON.stringify(item.domScanDelta)}`).join('; '));

  const unauthorized = await createTab({ name: 'unauthorized-old-background', kind: 'known', active: false });
  assert.ok(!Number.isInteger(unauthorized.tab.openerTabId), 'unauthorized page unexpectedly has an opener tab id');
  await installDomProbe(unauthorized.tab.id);
  const unauthorizedBefore = await waitProbeQuiet(unauthorized.tab.id);
  const unauthorizedApi = await contentState(unauthorized.tab.id);
  assert.ok(unauthorizedApi?.alive, 'static content script did not load on unauthorized old page');
  assert.equal(unauthorizedApi.session, false, 'old unauthorized background tab started a session');
  const unauthorizedQualityBefore = await pageQualityState(unauthorized.page);
  await playMain(unauthorized);
  await new Promise(resolve => setTimeout(resolve, 900));
  const unauthorizedVideo = await pageVideoState(unauthorized.page);
  const unauthorizedQualityAfter = await pageQualityState(unauthorized.page);
  const unauthorizedProbeAfter = await waitProbeQuiet(unauthorized.tab.id);
  assert.ok(!unauthorizedVideo?.marker, 'old unauthorized background page registered a video');
  assert.equal(unauthorizedQualityAfter.setters, unauthorizedQualityBefore.setters, 'old unauthorized background page called a quality setter');
  assert.deepEqual(unauthorizedProbeAfter, unauthorizedBefore, 'old unauthorized background page scanned its DOM');
  report.unauthorizedBackground = { tabId: unauthorized.tab.id, openerTabId: unauthorized.tab.openerTabId ?? null,
    api: unauthorizedApi, video: unauthorizedVideo, qualityBefore: unauthorizedQualityBefore,
    qualityAfter: unauthorizedQualityAfter, domProbeBefore: unauthorizedBefore, domProbeAfter: unauthorizedProbeAfter };
  record('舊未授權背景頁保持閒置', 'PASS', `tab ${unauthorized.tab.id}: no session, no marker, no quality setter, no DOM scan`);

  const expiryStart = noVideoExpiry.createdAt;
  const expiryDeadline = expiryStart + 61_000;
  await waitUntil(expiryDeadline);
  if (mode === 'candidate') {
    const snapshot = await activitySnapshot();
    const remainingLoading = snapshot.tabActivity?.loadingUntilByTab || {};
    const completedAfterWait = [];
    for (const item of cases) {
      const selector = item.kind === 'shadow' ? '__shadow__' : '#movie_player video.html5-main-video';
      const video = await pageVideoState(item.page, selector);
      const quality = await pageQualityState(item.page);
      const initial = lateOutcomes.find(outcome => outcome.name === item.name);
      assert.equal(video?.rate, 8, `${item.name} lost its 8x rate after the 60s wait`);
      assert.equal(video?.defaultRate, 8, `${item.name} lost its 8x default after the 60s wait`);
      assert.equal(quality.setters, initial?.qualitySetters, `${item.name} reapplied quality after initialization`);
      assert.equal(Object.hasOwn(remainingLoading, String(item.tab.id)), false, `${item.name} retained loadingUntilByTab after initialization`);
      completedAfterWait.push({ name: item.name, tabId: item.tab.id, rate: video.rate, defaultRate: video.defaultRate,
        qualitySettersBefore: initial?.qualitySetters, qualitySettersAfter: quality.setters,
        loadingLeasePresent: Object.hasOwn(remainingLoading, String(item.tab.id)) });
    }
    report.completedAfter60s = completedAfterWait;
    record('已初始化媒體在 60 秒後仍維持速率，且不重套畫質/不保留 loading lease', 'PASS',
      completedAfterWait.map(item => `${item.name}: ${item.rate}x, quality ${item.qualitySettersAfter}, lease ${item.loadingLeasePresent}`).join('; '));
  }
  const expiryProbeBefore = await waitProbeQuiet(noVideoExpiry.tab.id);
  const expiryApi = await contentState(noVideoExpiry.tab.id);
  assert.equal(expiryApi?.session, false, 'pending initializer session remained after the 60s hard deadline');
  const lateUnknown = await noVideoExpiry.page.evaluate(() => window.__qaSlowLoad.play());
  let expiryVideo = await waitFor(async () => pageVideoState(noVideoExpiry.page), '60s expiry video was not inserted');
  expiryVideo = await waitFor(async () => {
    const state = await pageVideoState(noVideoExpiry.page);
    return state && !state.paused && state.readyState >= 2 && state.currentTime > 0 ? state : null;
  }, '60s expiry fixture media did not really enter playing state', 10_000);
  await new Promise(resolve => setTimeout(resolve, 1_200));
  const expiryQuality = await pageQualityState(noVideoExpiry.page);
  const expiryProbeAfter = await waitProbeQuiet(noVideoExpiry.tab.id);
  assert.equal(expiryVideo.rate, 1, 'unknown video after the 60s lease received a rate');
  assert.equal(expiryVideo.defaultRate, 1, 'unknown video after the 60s lease received a default rate');
  assert.ok(!expiryVideo.marker, 'unknown video after the 60s lease was registered');
  assert.equal(expiryQuality.setters, 0, 'unknown video after the 60s lease called a quality setter');
  assert.deepEqual(expiryProbeAfter, expiryProbeBefore, 'unknown video after the 60s lease triggered DOM exploration');
  report.afterLeaseExpiry = { tabId: noVideoExpiry.tab.id, elapsedMs: Date.now() - expiryStart,
    apiBeforeLateVideo: expiryApi, video: expiryVideo, quality: expiryQuality,
    domProbeBefore: expiryProbeBefore, domProbeAfter: expiryProbeAfter, playResolved: !!lateUnknown };
  record('60 秒期限後未知影片不加入、不套用、不掃描', 'PASS', `elapsed ${report.afterLeaseExpiry.elapsedMs}ms; no marker, 1x, no quality setter`);

  const powerPage = await createTab({ name: 'global-off-control', kind: 'known', active: true, openerTabId: anchor.tab.id });
  const offBefore = await pageQualityState(powerPage.page);
  await seedSettings({ enabled: false });
  await waitFor(async () => (await contentState(powerPage.tab.id))?.session === false, 'global off did not stop the content session');
  await playMain(powerPage);
  await new Promise(resolve => setTimeout(resolve, 600));
  const offVideo = await pageVideoState(powerPage.page);
  const offQuality = await pageQualityState(powerPage.page);
  assert.ok(!offVideo?.initialized, 'global off initialized video rate');
  assert.equal(offVideo?.rate, 1, 'global off changed video rate');
  assert.equal(offQuality.setters, offBefore.setters, 'global off called a quality setter');
  report.globalOff = { tabId: powerPage.tab.id, api: await contentState(powerPage.tab.id), video: offVideo, quality: offQuality };
  record('全域關閉停止倍速與畫質控制', 'PASS', `tab ${powerPage.tab.id}: session stopped, rate ${offVideo?.rate}, quality setters ${offQuality.setters}`);

  const exclusionPage = await createTab({ name: 'youtube-full-exclusion', kind: 'known', active: true, openerTabId: anchor.tab.id });
  await seedSettings({ enabled: true, disabledSites: ['youtube.com'], siteModes: {} });
  await waitFor(async () => (await contentState(exclusionPage.tab.id))?.session === false, 'full YouTube exclusion did not stop the session');
  await playMain(exclusionPage);
  await new Promise(resolve => setTimeout(resolve, 700));
  const exclusionVideo = await pageVideoState(exclusionPage.page);
  const exclusionQuality = await pageQualityState(exclusionPage.page);
  assert.equal(exclusionVideo?.rate, 1, 'full exclusion changed video rate');
  assert.ok(!exclusionVideo?.initialized, 'full exclusion initialized video rate');
  assert.equal(exclusionQuality.setters, 0, 'full exclusion called a quality setter');
  report.fullExclusion = { tabId: exclusionPage.tab.id, api: await contentState(exclusionPage.tab.id), video: exclusionVideo, quality: exclusionQuality };
  record('YouTube 完整排除停止倍速與畫質控制', 'PASS', `tab ${exclusionPage.tab.id}: session stopped, rate ${exclusionVideo?.rate}, quality setters ${exclusionQuality.setters}`);

  const expectedLateApply = mode === 'candidate';
  const allExpected = lateOutcomes.every(item => item.expectedApplied === expectedLateApply) &&
    report.unauthorizedBackground.api.session === false && !report.unauthorizedBackground.video?.marker &&
    report.afterLeaseExpiry.video.rate === 1 && !report.afterLeaseExpiry.video.marker &&
    report.globalOff.video.rate === 1 && report.fullExclusion.video.rate === 1;
  assert.ok(allExpected, `${mode} expectations failed`);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = String(error?.stack || error?.message || error);
  report.errors.push({ message: String(error?.message || error) });
  report.failureBrowser={pages:context?.pages().map(p=>p.url()),tabs:await chromeTabs().catch(()=>null)};
} finally {
  report.blockedExternalRequests = [...blockedExternalRequests];
  report.completedAt = new Date().toISOString();
  await context?.close().catch(error => { report.cleanup.error ||= String(error?.message || error); });
  if (context) report.cleanup.browserClosed = true;
  if (fixtureServer) await new Promise(resolve => { fixtureServer.closeAllConnections?.(); fixtureServer.close(resolve); }).catch(error => { report.cleanup.error ||= String(error?.message || error); });
  if (profileRoot) {
    const resolved = await realpath(profileRoot).catch(() => path.resolve(profileRoot));
    const temp = await realpath(os.tmpdir()).catch(() => path.resolve(os.tmpdir()));
    const relative = path.relative(temp, resolved);
    if (!path.basename(resolved).startsWith('videospeed-qa077-') || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      report.cleanup.error ||= 'Refused cleanup outside dedicated videospeed-qa077 OS temp directory';
    } else {
      report.cleanup.verifiedInsideOsTemp = true;
      await rm(resolved, { recursive: true, force: true }).then(() => { report.cleanup.profileRemoved = true; }).catch(error => {
        report.cleanup.error ||= String(error?.message || error);
      });
    }
  }
  await mkdir(workDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8').catch(() => {});
}
}

await run();
console.log(JSON.stringify({ mode, result: report.result, extensionVersion: report.extensionVersion,
  runtimeSha256: report.runtimeSha256, chromium: report.chromium, lateOutcomes: report.lateOutcomes?.map(item => ({
    name: item.name, rate: item.rate, defaultRate: item.defaultRate, qualitySetters: item.qualitySetters, domScanDelta: item.domScanDelta,
  })), afterLeaseExpiry: report.afterLeaseExpiry ? { elapsedMs: report.afterLeaseExpiry.elapsedMs,
    marker: report.afterLeaseExpiry.video?.marker, rate: report.afterLeaseExpiry.video?.rate,
    qualitySetters: report.afterLeaseExpiry.quality?.setters } : null,
  cleanup: report.cleanup, outputPath, error: report.error || null }, null, 2));
if (report.result !== 'PASS') process.exitCode = 1;
