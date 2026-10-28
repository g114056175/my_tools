#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');
const outputDir = path.join(root, 'work/qa-086-final/quality-before-play');
const label = process.env.VIDEOSPEED_QA_LABEL?.trim() || 'current';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Invalid VIDEOSPEED_QA_LABEL');
const resultPath = path.join(outputDir, label + '-results.json');
const extensionDir = path.resolve(process.env.VIDEOSPEED_QA_EXTENSION_DIR?.trim() || path.join(root, 'extension'));
const browserPath = process.env.VIDEOSPEED_CHROMIUM?.trim() || chromium.executablePath();
const expectedVersion = '1.0.0';
const settings = {
  enabled: true, preferredRate: 2, defaultMode: 'custom', customRate: 2,
  steps: [1, 1.5, 2], qualityEnabled: true, preferredQuality: 720,
  shortcuts: { slower: '<', faster: '>', reset: ':', preferred: '"', fineSlower: '', fineFaster: '' },
  disabledSites: [], siteModes: {},
};
const report = {
  label, startedAt: new Date().toISOString(), result: 'INCOMPLETE', version: null,
  browser: { headless: true, executablePath: browserPath, nodeVersion: process.version, version: null },
  extension: { directory: extensionDir, runtimeFiles: 0, runtimeSha256: null, baselineArchiveSha256: null },
  fixture: { host: '127.0.0.1', media: 'tests/fixtures/tiny.webm', externalRequestsBlocked: true },
  scenario: { command: 'set 1.5× while the loaded video is paused', popupOpened: false },
  observations: {}, checks: [], blockedRequests: [], cleanup: { profileCreated: false, profileRemoved: false }, error: null,
};
let context, server, cdp, senderTargetId, profileDir, outputReal;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isChild = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
async function waitFor(read, labelText, timeout = 8000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try { const value = await read(); if (value) return value; } catch (error) { lastError = error; }
    await sleep(50);
  }
  throw new Error(labelText + (lastError ? ': ' + String(lastError.message || lastError) : ''));
}
async function sha256File(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
async function sha256Tree(directory) {
  const names = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(full); else names.push(path.relative(directory, full).replaceAll('\\', '/'));
    }
  }
  await visit(directory);
  names.sort();
  const hash = createHash('sha256');
  for (const name of names) hash.update(name).update('\0').update(await readFile(path.join(directory, name))).update('\0');
  return { count: names.length, hash: hash.digest('hex') };
}
function addCheck(name, passed, evidence) { report.checks.push({ name, passed: !!passed, evidence }); }
async function sample(page) {
  return page.evaluate(() => {
    const video = window.__qa?.video;
    return video ? {
      readyState: video.readyState, paused: video.paused, currentTime: video.currentTime,
      playbackRate: video.playbackRate, defaultPlaybackRate: video.defaultPlaybackRate,
      source: video.currentSrc || video.src,
      registryId: video.getAttribute('data-video-control-id'),
      initializedKey: video.getAttribute('data-video-control-initialized'),
      qualityInitializedKey: video.getAttribute('data-video-control-quality-initialized'),
      qualityCalls: [...window.__qa.qualityCalls],
    } : null;
  });
}

try {
  await mkdir(outputDir, { recursive: true });
  outputReal = await realpath(outputDir);
  const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
  report.version = manifest.version;
  if (manifest.version !== expectedVersion) throw new Error('Expected extension v' + expectedVersion + ', received v' + manifest.version);
  const tree = await sha256Tree(extensionDir);
  report.extension.runtimeFiles = tree.count;
  report.extension.runtimeSha256 = tree.hash;
  const archive = path.join(root, 'work/qa-086-final/release-before/VideoSpeed.zip');
  try { report.extension.baselineArchiveSha256 = await sha256File(archive); } catch {}

  profileDir = await mkdtemp(path.join(outputDir, 'profile-'));
  const profileReal = await realpath(profileDir);
  if (!isChild(outputReal, profileReal) || !path.basename(profileReal).startsWith('profile-')) {
    throw new Error('Temporary profile failed output-directory containment check');
  }
  report.cleanup.profileCreated = true;
  const fixtureBytes = await readFile(path.join(root, 'tests/fixtures/tiny.webm'));
  report.fixture.sha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><title>QA quality-before-play</title>',
    '<style>html,body{margin:0;width:100%;height:100%;background:#111}#movie_player{width:640px;height:360px}',
    '#movie_player video{width:640px;height:360px}</style></head><body><script>(()=>{',
    'const calls=[];const player=document.createElement("div");player.id="movie_player";player.className="html5-video-player";',
    'player.getAvailableQualityLevels=()=>["hd720","hd1080"];',
    'player.setPlaybackQualityRange=(min,max)=>calls.push({min,max,paused:video.paused,at:Date.now()});',
    'const video=document.createElement("video");video.id="qa-video";video.controls=true;video.muted=true;video.loop=true;video.playsInline=true;video.preload="auto";video.src="/tiny.webm";',
    'player.append(video);document.body.append(player);window.__qa={video,player,qualityCalls:calls};})();</script></body></html>',
  ].join('');
  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/fixture') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html); return;
    }
    if (url.pathname === '/tiny.webm') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range || ''));
      if (range) {
        const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : fixtureBytes.length - 1, fixtureBytes.length - 1);
        response.writeHead(206, { 'content-type': 'video/webm', 'accept-ranges': 'bytes',
          'content-range': 'bytes ' + start + '-' + end + '/' + fixtureBytes.length,
          'content-length': String(Math.max(0, end - start + 1)), 'cache-control': 'no-store' });
        response.end(fixtureBytes.subarray(start, end + 1)); return;
      }
      response.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes',
        'content-length': String(fixtureBytes.length), 'cache-control': 'no-store' });
      response.end(fixtureBytes); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  report.fixture.url = 'http://127.0.0.1:' + port + '/fixture';
  context = await chromium.launchPersistentContext(profileDir, {
    headless: true, executablePath: browserPath, viewport: { width: 1000, height: 800 },
    args: ['--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir],
  });
  report.browser.version = context.browser()?.version() || null;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:' || url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) === port) {
      return route.continue();
    }
    report.blockedRequests.push(url.origin);
    return route.abort('blockedbyclient');
  });
  const worker = await waitFor(() => context.serviceWorkers().find(item => item.url().endsWith('/background.js')),
    'VideoSpeed background worker did not start', 15000);
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(async settingsValue => chrome.storage.local.set({
    settings: settingsValue, lastRate: 1, lastRateRevision: 1,
  }), settings);
  cdp = await context.browser().newBrowserCDPSession();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message || error)));
  await page.goto(report.fixture.url, { waitUntil: 'domcontentloaded' });
  await waitFor(() => page.evaluate(() => {
    const video = window.__qa?.video;
    return video && video.readyState >= 2 && video.paused && video.getAttribute('data-video-control-id');
  }), 'video did not become registered, loaded, and paused');
  const beforeCommand = await sample(page);
  report.observations.beforeCommand = beforeCommand;
  addCheck('video is loaded and paused before the command', beforeCommand.readyState >= 2 && beforeCommand.paused,
    { readyState: beforeCommand.readyState, paused: beforeCommand.paused });

  const senderUrl = 'chrome-extension://' + extensionId + '/manifest.json?qa=quality-before-play-' + Date.now();
  senderTargetId = (await cdp.send('Target.createTarget', { url: senderUrl, background: true })).targetId;
  const senderPage = await waitFor(() => context.pages().find(item => item.url().startsWith(senderUrl)),
    'background extension message sender did not load', 8000);
  const command = await senderPage.evaluate(async () => {
    const [tab] = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
    if (!tab?.id) return { ok: false, error: 'No active video tab found' };
    const result = await new Promise(resolve => chrome.runtime.sendMessage({
      scope: 'video-control', action: 'command', command: 'set', value: 1.5, tabId: tab.id, reselect: true,
    }, response => resolve({ response, lastError: chrome.runtime.lastError?.message || null, tabId: tab.id })));
    return { ...result, ok: result.response?.ok === true && !result.lastError };
  });
  report.observations.extensionCommand = command;
  await cdp.send('Target.closeTarget', { targetId: senderTargetId }); senderTargetId = null;
  if (!command.ok) throw new Error('Extension command failed: ' + (command.lastError || command.response?.error || command.error));
  await waitFor(async () => { const state = await sample(page); return Math.abs(state?.playbackRate - 1.5) < 0.011; },
    'extension command did not set playback speed to 1.5×');
  await sleep(200);
  const afterCommand = await sample(page);
  report.observations.afterCommand = afterCommand;
  addCheck('extension command sets 1.5× while still paused', afterCommand.paused && Math.abs(afterCommand.playbackRate - 1.5) < 0.011,
    { paused: afterCommand.paused, playbackRate: afterCommand.playbackRate, defaultPlaybackRate: afterCommand.defaultPlaybackRate });
  addCheck('no quality setter runs before first playback', afterCommand.qualityCalls.length === 0,
    { setterCalls: afterCommand.qualityCalls.length });

  await page.evaluate(() => window.__qa.video.play());
  await waitFor(() => page.evaluate(() => !window.__qa.video.paused && window.__qa.video.currentTime > 0), 'video did not start playing');
  await sleep(2200);
  const afterFirstPlay = await sample(page);
  report.observations.afterFirstPlay = afterFirstPlay;
  addCheck('preferred quality is requested exactly once on first playback', afterFirstPlay.qualityCalls.length === 1,
    { expectedSetterCalls: 1, actualSetterCalls: afterFirstPlay.qualityCalls.length, calls: afterFirstPlay.qualityCalls });
  addCheck('first playback stays active and preserves the explicit 1.5× choice', !afterFirstPlay.paused && Math.abs(afterFirstPlay.playbackRate - 1.5) < 0.011,
    { paused: afterFirstPlay.paused, playbackRate: afterFirstPlay.playbackRate, defaultPlaybackRate: afterFirstPlay.defaultPlaybackRate });

  await page.evaluate(async () => { const video = window.__qa.video; video.pause(); await video.play(); });
  await sleep(500);
  const afterPausePlay = await sample(page);
  report.observations.afterPausePlay = afterPausePlay;
  addCheck('pause/play does not submit quality again', afterPausePlay.qualityCalls.length === afterFirstPlay.qualityCalls.length,
    { before: afterFirstPlay.qualityCalls.length, after: afterPausePlay.qualityCalls.length });

  await page.evaluate(() => { const video = window.__qa.video; video.pause(); video.load(); });
  await waitFor(() => page.evaluate(() => window.__qa.video.readyState >= 2 && window.__qa.video.paused), 'same-source reload did not finish loading');
  await page.evaluate(() => window.__qa.video.play());
  await waitFor(() => page.evaluate(() => !window.__qa.video.paused && window.__qa.video.currentTime > 0), 'same-source reload did not play');
  await sleep(700);
  const afterReload = await sample(page);
  report.observations.afterSameSourceReload = afterReload;
  addCheck('same-source load/play does not submit quality again', afterReload.qualityCalls.length === afterFirstPlay.qualityCalls.length,
    { before: afterFirstPlay.qualityCalls.length, after: afterReload.qualityCalls.length,
      sourceBefore: afterFirstPlay.source, sourceAfter: afterReload.source });
  addCheck('same-source load/play preserves 1.5×', Math.abs(afterReload.playbackRate - 1.5) < 0.011,
    { playbackRate: afterReload.playbackRate, defaultPlaybackRate: afterReload.defaultPlaybackRate });
  report.pageErrors = pageErrors;
  report.validation = { passed: report.checks.every(item => item.passed) && pageErrors.length === 0, checks: report.checks.length };
  report.result = report.validation.passed ? 'PASS' : 'FAIL';
} catch (error) {
  report.error = String(error?.stack || error?.message || error);
  report.validation = { passed: false, checks: report.checks.length };
  report.result = 'ERROR';
} finally {
  try { if (senderTargetId && cdp) await cdp.send('Target.closeTarget', { targetId: senderTargetId }); } catch {}
  try { if (cdp) await cdp.detach(); } catch {}
  try { if (context) await context.close(); } catch (error) { report.cleanup.contextCloseError = String(error?.message || error); }
  if (server) await new Promise(resolve => server.close(() => resolve()));
  if (profileDir && outputReal) {
    try {
      const resolvedProfile = await realpath(profileDir);
      if (!isChild(outputReal, resolvedProfile) || !path.basename(resolvedProfile).startsWith('profile-')) {
        throw new Error('Refusing to remove profile outside the verified output directory');
      }
      await rm(resolvedProfile, { recursive: true, force: true });
      report.cleanup.profileRemoved = true;
    } catch (error) { report.cleanup.error = String(error?.message || error); }
  }
  if (report.cleanup.error || report.cleanup.contextCloseError || !report.cleanup.profileRemoved) {
    report.result = 'ERROR';report.validation = { passed: false, checks: report.checks.length };
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ result: report.result, resultPath, runtimeSha256: report.extension.runtimeSha256,
    checks: report.checks, error: report.error, cleanup: report.cleanup }, null, 2));
}
if (report.result !== 'PASS') process.exitCode = 1;
