#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const reportDirectory = path.join(projectRoot, 'work', 'qa-069-exclusion');
const reportPath = path.join(reportDirectory, 'report.md');
const resultsPath = path.join(reportDirectory, 'results.json');
const screenshotDirectory = path.join(reportDirectory, 'screenshots');
const extensionRuntimeFiles = [
  'manifest.json', 'background.js', 'content.js', 'page-bridge.js',
  'popup.html', 'popup.js', 'popup.css', 'settings.js', 'site-rules.js', 'site-domain.js',
  'i18n.js', 'rate-memory.js', 'quality-options.js', 'tab-activity.js',
  'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png',
];
const checks = [];
const bundleHashes = {};
const blockedExternalRequests = new Set();
const pageErrors = [];
let context;
let hostPage;
let serviceWorker;
let extensionId = '';
let temporaryRoot;
let runtimeHash = 'unavailable';
let browserVersion = 'unavailable';
let productVersion = 'unavailable';
let fatalError = null;
const cleanupStatus = { temporaryProfileCreated: false, verifiedInsideOsTemp: false, removed: false, error: null };

const baseSettings = {
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
  checks.push({ name, status, detail: sanitize(detail) });
}

function sanitize(value) {
  let safeDetail = String(value || '');
  for (const localPath of [projectRoot, projectRoot.replaceAll('\\', '/'), pathToFileURL(projectRoot).href.replace(/\/$/u, '')]) {
    safeDetail = safeDetail.replaceAll(localPath, '<project>');
  }
  return safeDetail.replace(/\s+/gu, ' ').trim();
}

async function check(name, fn) {
  try {
    record(name, 'PASS', await fn());
  } catch (error) {
    record(name, 'FAIL', error?.stack || error?.message || error);
  } finally {
    for (const page of context?.pages() || []) {
      if (page.url() === `chrome-extension://${extensionId}/popup.html`) await page.close().catch(() => {});
    }
  }
}

async function waitFor(predicate, message, timeout = 8000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function worker() {
  if (serviceWorker?.url().includes(`chrome-extension://${extensionId}/`)) return serviceWorker;
  serviceWorker = context.serviceWorkers().find(item => item.url().includes(`chrome-extension://${extensionId}/`));
  if (serviceWorker) return serviceWorker;
  serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
  return serviceWorker;
}

async function storageGet(keys) {
  const sw = await worker();
  return sw.evaluate(async requested => chrome.storage.local.get(requested), keys);
}

async function seedSettings(patch = {}, memory = {}) {
  const sw = await worker();
  await sw.evaluate(async ({ patch, memory }) => {
    const current = await chrome.storage.local.get('settings');
    const settings = { ...current.settings, ...patch };
    await chrome.storage.local.set({ settings, ...memory });
  }, { patch: { ...baseSettings, ...patch }, memory });
  await new Promise(resolve => setTimeout(resolve, 180));
}

async function patchSettings(patch = {}, memory = {}) {
  const sw = await worker();
  await sw.evaluate(async ({ patch, memory }) => {
    const current = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...current.settings, ...patch }, ...memory });
  }, { patch, memory });
  await new Promise(resolve => setTimeout(resolve, 180));
}

async function setPopupPreferences(language, theme) {
  const sw = await worker();
  await sw.evaluate(async prefs => chrome.storage.local.set(prefs), { popupLanguage: language, popupTheme: theme });
  await new Promise(resolve => setTimeout(resolve, 120));
}

async function installTreeWalkerCounter() {
  const sw = await worker();
  return sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active fixture tab for TreeWalker instrumentation');
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: () => {
        const key = Symbol.for('videospeed.release-check.treewalker');
        if (globalThis[key]) return;
        const original = Document.prototype.createTreeWalker;
        const state = { documentRootScans: 0 };
        globalThis[key] = state;
        Document.prototype.createTreeWalker = function (...args) {
          if (args[0] === this && args[0]?.nodeType === 9) state.documentRootScans += 1;
          return Reflect.apply(original, this, args);
        };
      },
    });
    return tab.id;
  });
}

async function readTreeWalkerCount(tabId) {
  const sw = await worker();
  const rows = await sw.evaluate(id => chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] },
    world: 'ISOLATED',
    func: () => globalThis[Symbol.for('videospeed.release-check.treewalker')]?.documentRootScans ?? -1,
  }), tabId);
  return rows?.[0]?.result ?? -1;
}

async function settleDocumentScanCount(tabId) {
  let count = await readTreeWalkerCount(tabId);
  let stable = 0;
  while (stable < 4) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const next = await readTreeWalkerCount(tabId);
    if (next === count) stable += 1;
    else { count = next; stable = 0; }
  }
  return count;
}

async function cachedStateForActiveTab() {
  const sw = await worker();
  return sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const responses = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: tabId => new Promise(resolve => chrome.runtime.sendMessage(
        { scope: 'video-control', action: 'cachedState', tabId },
        response => resolve(chrome.runtime.lastError ? null : response),
      )),
      args: [tab.id],
    });
    return responses?.[0]?.result || null;
  });
}

async function isolatedApiState() {
  const sw = await worker();
  return sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const rows = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: () => {
        const api = globalThis[Symbol.for('video-control.api')];
        return { present: !!api, alive: !!api?.alive?.(), enabled: !!api?.enabled?.() };
      },
    });
    return rows?.[0]?.result || null;
  });
}

async function visualMarkerCount() {
  return hostPage.evaluate(() => ({
    highlight: document.querySelectorAll('[data-video-control-media-highlight]').length,
    toast: document.querySelectorAll('#video-control-toast').length,
  }));
}

function fixtureHtml(url) {
  const child = url.searchParams.get('child') || '';
  const iframe = url.searchParams.has('iframe')
    ? `<iframe id="qa-child" title="child video" src="${child || 'http://sub.example.test/fixture?frame=child'}"></iframe>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VideoSpeed QA fixture</title>
  <style>body{font:16px system-ui;margin:16px;background:#f3f5f8}#player{width:480px;max-width:92vw;background:#111;padding:10px;border-radius:8px}video{display:block;width:100%;height:220px;background:#050505}iframe{display:block;width:500px;height:300px;border:1px solid #888;margin-top:12px}</style></head>
  <body><h1>QA fixture</h1><div id="player" role="region" aria-label="Test video player"><video id="qa-video" autoplay muted loop playsinline controls src="/tiny.webm"></video></div>${iframe}
  <script>
  (()=>{
    const player=document.querySelector('#player');
    const stats={qualityReads:0,qualitySetters:[]};
    player.getAvailableQualityLevels=()=>{stats.qualityReads++;return ['hd720','hd1080']};
    player.setPlaybackQualityRange=(min,max)=>{stats.qualitySetters.push([min,max])};
    window.__qaQuality=stats;
    window.qaVideo=()=>document.querySelector('#qa-video');
    window.qaReplaceVideo=async suffix=>{
      const old=qaVideo(),next=document.createElement('video');
      next.id='qa-video';next.autoplay=true;next.muted=true;next.loop=true;next.playsInline=true;next.controls=true;
      next.src='/tiny.webm?media='+encodeURIComponent(suffix);old.replaceWith(next);
      try{await next.play()}catch{};return next;
    };
    window.qaSpa=path=>{history.pushState({},'',path);window.dispatchEvent(new Event('popstate'))};
  })();
  </script></body></html>`;
}

async function installNetworkIsolation(mediaBytes) {
  await context.route('**/*', async route => {
    const raw = route.request().url();
    let url;
    try { url = new URL(raw); } catch { return route.abort('blockedbyclient'); }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'about:' || url.protocol === 'data:') return route.continue();
    if (url.protocol === 'http:' && url.hostname.endsWith('.test')) {
      if (url.pathname.endsWith('/tiny.webm')) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body: mediaBytes });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body: fixtureHtml(url) });
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') blockedExternalRequests.add(`${url.protocol}//${url.host}`);
    return route.abort('blockedbyclient');
  });
}

async function openFixture(host = 'example.test', query = '') {
  const url = `http://${host}/fixture${query ? `?${query}` : ''}`;
  await hostPage.goto(url, { waitUntil: 'domcontentloaded' });
  await hostPage.waitForSelector('#qa-video');
  await waitFor(() => hostPage.evaluate(() => document.querySelector('#qa-video')?.readyState >= 1), `video metadata not ready on ${host}`);
  return hostPage;
}

async function videoState(page = hostPage, selector = '#qa-video') {
  return page.evaluate(selector => {
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

async function waitVideoRate(expected, page = hostPage, selector = '#qa-video') {
  await waitFor(async () => {
    const state = await videoState(page, selector);
    return state && Math.abs(state.rate - expected) < 0.011;
  }, `video rate did not become ${expected}×`);
}

async function openExtensionPage({ language = 'zh-Hant', theme = 'light' } = {}) {
  await setPopupPreferences(language, theme);
  await hostPage.bringToFront();
  const targetUrl = `chrome-extension://${extensionId}/popup.html`;
  let popup = context.pages().find(page => page.url() === targetUrl);
  if (!popup) {
    const cdp = await context.newCDPSession(hostPage);
    await cdp.send('Target.createTarget', { url: targetUrl, background: true });
    await cdp.detach();
    popup = await waitFor(() => context.pages().find(page => page.url() === targetUrl), 'extension popup page was not created');
  }
  await popup.setViewportSize({ width: 420, height: 800 });
  await popup.waitForSelector('#advanced');
  await popup.waitForFunction(() => document.readyState === 'complete');
  await waitFor(() => popup.locator('html').getAttribute('lang').then(value => value === (language === 'en' ? 'en' : 'zh-Hant')), 'popup language did not initialize');
  await waitFor(() => popup.locator('html').getAttribute('data-theme').then(value => value === theme), 'popup theme did not initialize');
  return popup;
}

async function openSites(popup) {
  await popup.locator('#advanced > summary').click();
  await popup.locator('#tab-sites').click();
  await popup.waitForFunction(() => !document.querySelector('#panel-sites').hidden);
}

async function currentTabUrl(popup) {
  return popup.evaluate(() => new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]?.url || ''))));
}

async function popupRate(popup, value) {
  const input = popup.locator('#current-rate');
  await waitFor(() => input.evaluate(element => !element.disabled), 'popup did not find an active video');
  await input.fill(String(value));
  await input.press('Enter');
  await waitVideoRate(value);
}

async function removePopupPage(popup) {
  if (popup && !popup.isClosed()) await popup.close().catch(() => {});
}

async function checkLayoutScreenshots() {
  await mkdir(screenshotDirectory, { recursive: true });
  const matrix = [
    ['zh-Hant', 'light'], ['zh-Hant', 'dark'], ['en', 'light'], ['en', 'dark'],
  ];
  for (const [language, theme] of matrix) {
    let popup;
    try {
      await seedSettings({ disabledSites: ['example.test', 'other.test', 'sub.example.test'], siteModes: { 'example.test': 'default' } }, { popupLanguage: language, popupTheme: theme });
      await hostPage.bringToFront();
      const targetUrl = `chrome-extension://${extensionId}/popup.html`;
      const cdp = await context.newCDPSession(hostPage);
      await cdp.send('Target.createTarget', { url: targetUrl, background: true });
      await cdp.detach();
      popup = await waitFor(() => context.pages().find(page => page.url() === targetUrl), 'extension page for screenshot was not created');
      await popup.setViewportSize({ width: 420, height: 800 });
      await popup.waitForSelector('#advanced');
      await openSites(popup);
      await waitFor(() => popup.evaluate(language => document.documentElement.lang === (language === 'en' ? 'en' : 'zh-Hant'), language), 'screenshot language did not initialize');
      const metrics = await popup.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        bodyHeight: document.body.getBoundingClientRect().height,
        rows: [...document.querySelectorAll('.site-rule')].map(row => ({
          rule: row.querySelector('span')?.textContent,
          buttons: [...row.querySelectorAll('button')].map(button => {
            const box = button.getBoundingClientRect();
            return { text: button.textContent.trim(), width: box.width, height: box.height, title: button.title };
          }),
        })),
      }));
      assert.equal(metrics.viewport, 420, 'extension page viewport must be 420px');
      assert.ok(metrics.document <= 420 && metrics.body <= 420, `horizontal overflow at ${language}/${theme}: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.bodyHeight > 0 && metrics.bodyHeight <= 590, `body content exceeds native popup height at ${language}/${theme}: ${metrics.bodyHeight}px`);
      assert.equal(metrics.rows.length, 3, 'expected three exclusion rows');
      assert.ok(metrics.rows.every(row => row.buttons.length === 2 && row.buttons.every(button => button.width >= 24 && button.height >= 24)), `exclusion click target below 24px at ${language}/${theme}`);
      assert.deepEqual(metrics.rows.map(row => row.buttons[0].text), ['Default', 'Full', 'Full']);
      assert.equal(metrics.rows[0].buttons[0].title, 'Skip automatic speed and quality settings');
      assert.ok(metrics.rows.slice(1).every(row => row.buttons[0].title === 'Disable all features on this site'));
      const screenshotName = `exclude-${language.toLowerCase()}-${theme}.png`;
      await popup.locator('body').screenshot({ path: path.join(screenshotDirectory, screenshotName) });
      record(`420px ${language}/${theme} Exclude layout`, 'PASS', `body ${Math.round(metrics.bodyHeight)}px high; no horizontal overflow; 1 Default and 2 Full rows; click targets ≥24px; ${screenshotName}`);
    } catch (error) {
      record(`420px ${language}/${theme} Exclude layout`, 'FAIL', error?.stack || error?.message || error);
    } finally {
      await removePopupPage(popup);
    }
  }
}

async function runChecks() {
  // A 0.6.5-style rule has no mode and must continue to mean Full.
  await check('舊 disabledSites 規則維持 Full；不自動套用、探查或回應快捷鍵', async () => {
    await seedSettings({ disabledSites: ['example.test'], siteModes: {}, defaultMode: 'custom', customRate: 8, qualityEnabled: true }, { lastRate: 3, lastRateRevision: 4 });
    await openFixture('example.test');
    await waitFor(async () => (await videoState())?.readyState >= 2, 'legacy fixture video did not start');
    await new Promise(resolve => setTimeout(resolve, 450));
    const before = await videoState();
    const storedBefore = await storageGet(['lastRate', 'lastRateRevision']);
    assert.equal(before.rate, 1);
    assert.equal(before.marker, null);
    assert.equal((await hostPage.evaluate(() => window.__qaQuality.qualityReads)), 0);
    assert.equal((await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length)), 0);
    await hostPage.bringToFront();
    await hostPage.keyboard.press('>');
    await hostPage.keyboard.press(':');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal((await videoState()).rate, 1);
    assert.equal((await storageGet(['lastRate', 'lastRateRevision'])).lastRateRevision, storedBefore.lastRateRevision);
    return 'legacy rule excluded the video; no bridge marker, quality discovery/setter, shortcut or memory write';
  });

  // Default disables only automatic startup behavior; controls and explicit memory writes remain available.
  await check('Default 頁首載影片維持 1×；手動控制、快捷鍵、跟隨記憶與 SPA 切換', async () => {
    await seedSettings({ disabledSites: ['example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, preferredRate: 2, qualityEnabled: true }, { lastRate: 3, lastRateRevision: 4 });
    await openFixture('example.test');
    await waitFor(async () => (await videoState())?.marker, 'Default page video was not registered');
    await waitFor(async () => (await videoState())?.readyState >= 2, 'Default page video did not start');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal((await videoState()).rate, 1);
    assert.equal((await videoState()).defaultRate, 1);
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualityReads), 0);
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length), 0);
    assert.equal((await storageGet(['lastRate'])).lastRate, 3, 'automatic handling changed follow memory');

    let popup = await openExtensionPage({ language: 'en', theme: 'light' });
    assert.match(await currentTabUrl(popup), /^http:\/\/example\.test\//, 'extension page must target the still-active fixture tab');
    await popupRate(popup, 8);
    assert.equal((await storageGet(['lastRate'])).lastRate, 8, 'explicit popup input did not update speed memory');
    await hostPage.bringToFront();
    await hostPage.keyboard.press('<');
    await waitVideoRate(6);
    await hostPage.keyboard.press('>');
    await waitVideoRate(8);
    await hostPage.keyboard.press(':');
    await waitVideoRate(1);
    await hostPage.keyboard.press('Shift+Quote');
    await waitVideoRate(2);
    assert.equal((await storageGet(['lastRate'])).lastRate, 2, 'explicit shortcut did not update memory');

    await patchSettings({ defaultMode: 'follow' }, { lastRate: 3, lastRateRevision: 20 });
    await hostPage.evaluate(() => window.qaReplaceVideo('follow-new'));
    await waitFor(async () => (await videoState())?.marker && (await videoState())?.readyState >= 2, 'new Default video was not registered');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal((await videoState()).rate, 1, 'Default page followed global lastRate');
    assert.equal((await storageGet(['lastRate'])).lastRate, 3, 'automatic initialization changed follow memory');
    popup = await openExtensionPage({ language: 'en', theme: 'light' });
    await popupRate(popup, 8);
    assert.equal((await storageGet(['lastRate'])).lastRate, 8, 'explicit speed did not update follow memory');
    await hostPage.bringToFront();
    await hostPage.evaluate(() => window.qaSpa('/route-after-speed'));
    await hostPage.evaluate(() => window.qaReplaceVideo('spa-new'));
    await waitFor(async () => (await videoState())?.marker && (await videoState())?.readyState >= 2, 'SPA replacement video was not registered');
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal((await videoState()).rate, 1, 'SPA/new video received global follow speed on Default site');
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length), 0);
    await removePopupPage(popup);
    return 'global custom 8× and follow 3× did not auto-apply; popup 8×, <, >, :, preferred shortcut worked; explicit actions alone updated memory; replacement and SPA video stayed 1×';
  });

  await check('Default→Full 即時清理標記並停止快捷控制；Full→Default 規則儲存且保留列順序', async () => {
    await seedSettings({ disabledSites: ['example.test', 'other.test', 'sub.example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, qualityEnabled: true }, { lastRate: 8, lastRateRevision: 21, popupLanguage: 'en', popupTheme: 'light' });
    await openFixture('example.test');
    await waitFor(async () => (await videoState())?.marker, 'Default page video was not registered before Full transition');
    await new Promise(resolve => setTimeout(resolve, 250));
    const popup = await openExtensionPage({ language: 'en', theme: 'light' });
    await openSites(popup);
    const row = popup.locator('.site-rule').nth(0);
    await waitFor(() => row.locator('.site-mode').innerText().then(text => text === 'Default'), 'example.test was not Default');
    assert.equal(await row.locator('.site-mode').getAttribute('title'), 'Skip automatic speed and quality settings');
    const beforeOrder = await popup.locator('.site-rule > span').allTextContents();
    for (const [index] of beforeOrder.entries()) {
      const mode = popup.locator('.site-rule').nth(index).locator('.site-mode');
      if (await mode.innerText() === 'Full') {
        await mode.click();
        const rule = beforeOrder[index];
        await waitFor(async () => (await storageGet(['settings'])).settings.siteModes[rule] === 'default', `Full→Default mode did not persist for ${rule}`);
      }
    }
    await waitFor(async () => (await storageGet(['settings'])).settings.siteModes['other.test'] === 'default', 'Full→Default mode did not persist');
    const afterOrder = await popup.locator('.site-rule > span').allTextContents();
    assert.deepEqual(afterOrder, beforeOrder, 'changing a mode reordered exclusion rows');
    const persisted = (await storageGet(['settings'])).settings;
    assert.deepEqual(persisted.siteModes, { 'example.test': 'default', 'other.test': 'default', 'sub.example.test': 'default' });
    assert.equal(await popup.locator('.site-rule').nth(0).locator('.site-mode').getAttribute('title'), 'Skip automatic speed and quality settings');

    await waitFor(async () => {
      const markers = await visualMarkerCount();
      return markers.highlight > 0 || markers.toast > 0;
    }, 'popup did not create a visible highlight/toast before Full transition');
    assert.equal((await isolatedApiState())?.enabled, true, 'Default page engine should be enabled before Full transition');

    const targetRow = popup.locator('.site-rule').nth(0);
    await targetRow.locator('.site-mode').click();
    await waitFor(async () => (await storageGet(['settings'])).settings.siteModes['example.test'] === undefined, 'Default→Full mode did not clear siteModes entry');
    const engineDisabled = await waitFor(async () => {
      const api = await isolatedApiState();
      return !api?.present || !api?.alive || !api?.enabled;
    }, 'Full mode did not disable the isolated content engine', 2500).then(() => true, () => false);
    const markerCleared = await waitFor(async () => {
      const markers = await visualMarkerCount();
      return markers.highlight === 0 && markers.toast === 0;
    }, 'Full mode did not clear video highlight/toast', 2500).then(() => true, () => false);
    const fullState = await videoState();
    await hostPage.bringToFront();
    await hostPage.keyboard.press('<');
    await new Promise(resolve => setTimeout(resolve, 200));
    const shortcutIgnored = (await videoState()).rate === fullState.rate;
    assert.ok(engineDisabled && markerCleared && shortcutIgnored, `Full transition engineDisabled=${engineDisabled}, highlightAndToastCleared=${markerCleared}, shortcutIgnored=${shortcutIgnored}`);
    assert.equal(await popup.locator('.site-rule').nth(0).locator('.site-mode').innerText(), 'Full');
    await removePopupPage(popup);
    return `three Full rows became Default without reordering; English titles matched; Default→Full disabled/disposed engine, cleared visible highlight/toast, and ignored shortcuts`;
  });

  await check('Full／Default 親頁對 iframe 傳遞規則；子 frame Full 覆蓋 Default', async () => {
    await seedSettings({ disabledSites: ['example.test'], siteModes: {}, defaultMode: 'custom', customRate: 8, qualityEnabled: true });
    await openFixture('example.test', 'iframe=1');
    const child = hostPage.frames().find(frame => frame.url().includes('sub.example.test'));
    await waitFor(() => child?.locator('#qa-video').count(), 'child frame was not created');
    await waitFor(() => child.evaluate(() => document.querySelector('#qa-video')?.readyState >= 2), 'Full child video did not start');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal((await videoState()).marker, null, 'Full parent exposed a top-frame marker');
    assert.equal(await child.evaluate(() => document.querySelector('#qa-video').playbackRate), 1, 'Full parent did not disable child frame');
    assert.equal(await child.evaluate(() => document.querySelector('#qa-video').getAttribute('data-video-control-id')), null);

    await seedSettings({ disabledSites: ['example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, qualityEnabled: true });
    await openFixture('example.test', 'iframe=1');
    const inheritedChild = hostPage.frames().find(frame => frame.url().includes('sub.example.test'));
    await waitFor(async () => (await videoState())?.marker && await inheritedChild.evaluate(() => document.querySelector('#qa-video')?.getAttribute('data-video-control-id')), 'Default frame inheritance was not initialized');
    await waitFor(() => inheritedChild.evaluate(() => document.querySelector('#qa-video')?.readyState >= 2), 'Default child video did not start');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal((await videoState()).rate, 1);
    assert.equal(await inheritedChild.evaluate(() => document.querySelector('#qa-video').playbackRate), 1, 'Default parent did not suppress global custom rate in child');

    await seedSettings({ disabledSites: ['example.test', 'sub.example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, qualityEnabled: true });
    await openFixture('example.test', 'iframe=1');
    const overriddenChild = hostPage.frames().find(frame => frame.url().includes('sub.example.test'));
    await waitFor(async () => (await videoState())?.marker, 'Default top frame was not active with child Full rule');
    await waitFor(() => overriddenChild.evaluate(() => document.querySelector('#qa-video')?.readyState >= 2), 'Full override child did not start');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal((await videoState()).rate, 1, 'child Full rule incorrectly disabled Default parent');
    assert.equal(await overriddenChild.evaluate(() => document.querySelector('#qa-video').playbackRate), 1, 'child Full rule allowed global custom rate');
    assert.equal(await overriddenChild.evaluate(() => document.querySelector('#qa-video').getAttribute('data-video-control-id')), null, 'child Full rule retained extension marker');
    return 'Full parent disabled both frames; Default parent suppressed global 8× in both; child-specific Full disabled only the subframe';
  });

  await check('移除規則同步清除 siteModes；未除外網站仍首播套用速度與畫質', async () => {
    await seedSettings({ disabledSites: ['example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, qualityEnabled: true });
    await openFixture('example.test');
    await waitFor(async () => (await videoState())?.marker, 'Default page not available for remove test');
    const popup = await openExtensionPage({ language: 'en', theme: 'light' });
    await openSites(popup);
    await popup.getByRole('button', { name: 'Remove example.test' }).click();
    await waitFor(async () => (await storageGet(['settings'])).settings.disabledSites.length === 0, 'rule removal did not persist');
    const afterRemove = (await storageGet(['settings'])).settings;
    assert.deepEqual(afterRemove.siteModes, {});
    assert.equal(await popup.locator('.site-rule').count(), 0);
    await removePopupPage(popup);

    await seedSettings({ disabledSites: [], siteModes: {}, defaultMode: 'custom', customRate: 8, qualityEnabled: true, preferredQuality: 720 });
    await openFixture('outside.test');
    await waitVideoRate(8);
    await waitFor(async () => await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length > 0), 'non-excluded page quality setter was not called');
    assert.equal((await videoState()).rate, 8);
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualitySetters[0]?.[0]), 'hd720');
    return 'removed rule left no siteModes key; outside.test started at custom 8× and invoked synthetic hd720 quality API';
  });

  await check('全域關閉優先於 Default 規則', async () => {
    await seedSettings({ enabled: false, disabledSites: ['example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, qualityEnabled: true });
    await openFixture('example.test');
    await waitFor(async () => (await videoState())?.readyState >= 2, 'global-off fixture video did not start');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal((await videoState()).rate, 1);
    assert.equal((await videoState()).marker, null);
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length), 0);
    return 'globally disabled extension did not register video, apply custom speed or call quality setter';
  });

  await check('快取 popup 不深掃；手動 Refresh 仍檢查畫質能力', async () => {
    await seedSettings({ enabled: true, disabledSites: ['example.test'], siteModes: { 'example.test': 'default' }, defaultMode: 'custom', customRate: 8, qualityEnabled: true });
    await openFixture('example.test');
    await waitFor(async () => (await videoState())?.marker, 'Default fixture video was not registered for cache check');
    await new Promise(resolve => setTimeout(resolve, 400));
    const cachedBeforePopup = await waitFor(async () => {
      const state = await cachedStateForActiveTab();
      return state?.ok && state.target?.id ? state : null;
    }, 'background has no cached target for the popup fast-path check');
    const tabId = await installTreeWalkerCounter();
    const treeWalkerBefore = await settleDocumentScanCount(tabId);
    const readsBeforePopup = await hostPage.evaluate(() => window.__qaQuality.qualityReads);
    assert.equal(readsBeforePopup, 0, 'Default startup performed quality exploration');
    const popup = await openExtensionPage({ language: 'en', theme: 'light' });
    await waitFor(() => popup.locator('#playback').isHidden().then(value => !value), 'cached popup did not display registered video controls');
    await new Promise(resolve => setTimeout(resolve, 250));
    const treeWalkerAfterPopup = await readTreeWalkerCount(tabId);
    assert.equal(treeWalkerAfterPopup, treeWalkerBefore, 'cached popup performed a document-root deep TreeWalker scan');
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length), 0, 'cached popup applied quality automatically');
    await popup.locator('#refresh').click();
    await waitFor(async () => (await readTreeWalkerCount(tabId)) > treeWalkerAfterPopup, 'manual refresh did not perform a document-root deep walk');
    await waitFor(async () => (await hostPage.evaluate(() => window.__qaQuality.qualityReads)) > 0, 'manual refresh did not inspect quality API');
    assert.equal(await hostPage.evaluate(() => window.__qaQuality.qualitySetters.length), 0, 'manual capability inspection called a quality setter');
    await removePopupPage(popup);
    return `background cached target ${cachedBeforePopup.target.id}; popup added no document-root deep walk or quality setter; explicit Refresh added a document-root walk and inspected the read-only quality API`;
  });

  await checkLayoutScreenshots();
}

async function writeReport() {
  await mkdir(reportDirectory, { recursive: true });
  const lines = [
    `# VideoSpeed ${productVersion} exclusion browser release check`,
    '',
    `- Product version: ${productVersion}`,
    `- Runtime SHA-256: \`${runtimeHash}\``,
    `- Chromium: ${browserVersion}`,
    `- Run time: ${new Date().toISOString()}`,
    '- Browser: isolated Playwright Chromium persistent context; disposable profile created with `mkdtemp`.',
    '- Network: `.test` fixtures and `tiny.webm` served with `route.fulfill`; all other HTTP(S) requests aborted.',
    '- Page-quality adapter calls are synthetic fixture API checks; they do not establish behavior on YouTube or another live streaming site.',
    '- Layout screenshots show extension-page content at 420px. Native browser-toolbar popup chrome was not verified.',
    '- Machine-readable release gate: [results.json](results.json).',
    '',
    '## Results',
    '',
    '| Status | Check | Details |',
    '|---|---|---|',
    ...checks.map(item => `| ${item.status} | ${item.name.replaceAll('|', '\\|')} | ${item.detail.replaceAll('|', '\\|')} |`),
    '',
    `- External HTTP(S) requests blocked: ${blockedExternalRequests.size}${blockedExternalRequests.size ? ` (${[...blockedExternalRequests].join(', ')})` : ''}`,
    `- Page errors: ${pageErrors.length}${pageErrors.length ? ` (${pageErrors.join(' | ')})` : ''}`,
    '',
    '## Screenshots',
    '',
    ...['zh-hant-light', 'zh-hant-dark', 'en-light', 'en-dark'].map(name => `- [${name}](screenshots/exclude-${name}.png)`),
    '',
  ];
  await writeFile(reportPath, lines.join('\n'), 'utf8');
  await writeFile(resultsPath, JSON.stringify({
    version: productVersion,
    chromium: browserVersion,
    runtimeSha256: runtimeHash,
    bundleHashes,
    checks: checks.map(item => ({ name: item.name, pass: item.status === 'PASS', detail: item.detail })),
    failures: checks.filter(item => item.status === 'FAIL').map(item => ({ name: item.name, detail: item.detail })),
    outsideRequests: [...blockedExternalRequests],
    pageErrors: pageErrors.map(sanitize),
    cleanup: cleanupStatus,
  }, null, 2) + '\n', 'utf8');
}

try {
  await mkdir(reportDirectory, { recursive: true });
  await stat(fixturePath);
  const manifest = JSON.parse(await readFile(path.join(extensionDirectory, 'manifest.json'), 'utf8'));
  productVersion = manifest.version;
  assert.equal(manifest.name, 'VideoSpeed');
  assert.equal(manifest.version, JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version);
  const hash = createHash('sha256');
  for (const filename of extensionRuntimeFiles) {
    const bytes = await readFile(path.join(extensionDirectory, filename));
    bundleHashes[filename] = createHash('sha256').update(bytes).digest('hex');
    hash.update(filename).update('\0').update(bytes).update('\0');
  }
  runtimeHash = hash.digest('hex');

  const requestedExecutable = process.env.VIDEOSPEED_CHROMIUM?.trim();
  if (requestedExecutable && !path.isAbsolute(requestedExecutable)) throw new Error('VIDEOSPEED_CHROMIUM must be an absolute path');
  const executablePath = requestedExecutable || chromium.executablePath();
  if (!path.isAbsolute(executablePath)) throw new Error(`Chromium executable path is not absolute: ${executablePath}`);
  await stat(executablePath);

  temporaryRoot = await (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'videospeed-release-'));
  cleanupStatus.temporaryProfileCreated = true;
  const profileDirectory = path.join(temporaryRoot, 'profile');
  context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath,
    headless: true,
    viewport: { width: 420, height: 800 },
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
    ],
  });
  context.setDefaultTimeout(10000);
  context.on('page', page => page.on('pageerror', error => pageErrors.push(`${page.url()}: ${error.message}`)));
  await installNetworkIsolation(await readFile(fixturePath));
  browserVersion = context.browser()?.version() || 'unknown';
  serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = new URL(serviceWorker.url()).host;
  hostPage = context.pages()[0] || await context.newPage();
  await runChecks();
} catch (error) {
  fatalError = error;
  if (!checks.length) record('Browser setup', 'FAIL', error?.stack || error?.message || error);
} finally {
  await context?.close().catch(error => { fatalError ||= error; });
  if (temporaryRoot) {
    const resolved = await realpath(temporaryRoot).catch(() => path.resolve(temporaryRoot));
    const tempBase = `${path.resolve(os.tmpdir())}${path.sep}`;
    const relative = path.relative(tempBase, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolved).startsWith('videospeed-release-')) {
      cleanupStatus.error = 'Refused path outside this run’s mkdtemp directory';
      fatalError ||= new Error(cleanupStatus.error);
    } else {
      cleanupStatus.verifiedInsideOsTemp = true;
      await rm(resolved, { recursive: true, force: true }).then(() => { cleanupStatus.removed = true; }).catch(error => {
        cleanupStatus.error = sanitize(error?.message || error);
        fatalError ||= error;
      });
    }
  }
  await writeReport().catch(error => { fatalError ||= error; });
}

const failures = checks.filter(item => item.status === 'FAIL');
console.log(`VideoSpeed browser check: ${checks.length - failures.length}/${checks.length} passed`);
console.log(`Report: ${reportPath}`);
console.log(`Runtime SHA-256: ${runtimeHash}`);
if (fatalError) console.error(fatalError.stack || fatalError.message || fatalError);
if (failures.length) {
  for (const item of failures) console.error(`FAIL ${item.name}: ${item.detail}`);
  process.exitCode = 1;
} else if (fatalError) process.exitCode = 1;
