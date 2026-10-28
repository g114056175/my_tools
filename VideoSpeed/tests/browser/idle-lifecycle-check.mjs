import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const qaRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../work/qa-076-lifecycle');
const projectRoot = resolve(qaRoot, '../..');
const candidateVersion = JSON.parse(await readFile(join(projectRoot,'extension/manifest.json'),'utf8')).version;
const extensionCopy = resolve(qaRoot, 'extension-baseline');
const runMode = process.argv[2] === 'candidate' ? 'candidate' : 'baseline';
const baselineRef = '9b488d07d9a0942b7bbc97a5e479f8a53c30c203';
const oldManifestVersion = runMode === 'candidate' ? '0.6.13.1' : '0.6.13';
const executablePathHint = process.env.VIDEOSPEED_CHROMIUM?.trim() || chromium.executablePath();
const browserLabel = (process.env.VIDEOSPEED_BROWSER_LABEL?.trim() || (/brave/i.test(basename(executablePathHint)) ? 'brave' : 'chromium')).toLowerCase().replace(/[^a-z0-9-]/g, '-');
const outputName = `${runMode}-${browserLabel}`;
const marker = 'QA076_COLLECTOR_POSITIVE_PROBE';
const startedAt = new Date().toISOString();
const events = { pageErrors: [], consoleErrors: [], cdpExceptions: [], contexts: [], workerConsoleErrors: [], workerEvents: [] };
const delay = ms => new Promise(done => setTimeout(done, ms));
const inside = (target, root) => {
  const rel = relative(resolve(root), resolve(target));
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
function requireInside(target, root, label) {
  if (!inside(target, root)) throw new Error(`${label} escaped its allowed root: ${target}`);
  return resolve(target);
}

let server, context, inspector, extensionId, extensionVersion, origin, temporaryRoot, profilePath;
let browserVersion = null, commandLine = null, positiveProbe = null, probeCleanup = null;
let fixtureEvidence = null, updateEvidence = null, bfcacheEvidence = null, finalExtensionInfo = null;
let candidateBuild = null, controlEvidence = null, postUpdateNewTab = null;
let fatal = null, profileRemoved = false, extensionFiles = [], phase = 'setup';
const cdpSessions = [];
const watchedWorkers = new WeakSet();

async function waitFor(predicate, label, timeoutMs = 15000, stepMs = 100) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await predicate(); if (last) return last; } catch (error) { last = error?.message || String(error); }
    await delay(stepMs);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function copyHeadExtension() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  const relativeExtension = relative(repoRoot, resolve(projectRoot, 'extension')).replaceAll('\\', '/');
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', `${baselineRef}:${relativeExtension}`], { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  if (names.length !== 27) throw new Error(`Expected 27 tracked files under ${baselineRef}:${relativeExtension}; found ${names.length}`);
  requireInside(extensionCopy, qaRoot, 'baseline extension copy');
  await rm(extensionCopy, { recursive: true, force: true });
  for (const name of names) {
    const destination = requireInside(join(extensionCopy, name), extensionCopy, 'baseline extension file');
    await mkdir(dirname(destination), { recursive: true });
    const contents = execFileSync('git', ['show', `${baselineRef}:${relativeExtension}/${name}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
    await writeFile(destination, contents);
  }
  extensionFiles = names;
  const manifestPath = join(extensionCopy, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== '0.6.13') throw new Error(`${baselineRef} extension manifest version is ${manifest.version}, expected 0.6.13`);
  return { repoRoot, relativeExtension, ref: baselineRef, fileCount: names.length, manifestVersion: manifest.version };
}

async function copyCandidateExtension(targetManifestVersion = candidateVersion) {
  const candidateSource = resolve(projectRoot, 'extension');
  const sourceManifest = JSON.parse(await readFile(join(candidateSource, 'manifest.json'), 'utf8'));
  if (sourceManifest.version !== candidateVersion) throw new Error(`Expected candidate extension ${candidateVersion}; found ${sourceManifest.version}`);
  const digest = createHash('sha256');
  for (const name of extensionFiles) {
    const source = join(candidateSource, name);
    const destination = requireInside(join(extensionCopy, name), extensionCopy, 'candidate extension file');
    const contents = await readFile(source);
    digest.update(name); digest.update('\0'); digest.update(contents); digest.update('\0');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  const copiedManifest = JSON.parse(await readFile(join(extensionCopy, 'manifest.json'), 'utf8'));
  if (copiedManifest.version !== candidateVersion) throw new Error(`Candidate copy has version ${copiedManifest.version}`);
  if (targetManifestVersion !== copiedManifest.version) {
    copiedManifest.version = targetManifestVersion;
    await writeFile(join(extensionCopy, 'manifest.json'), JSON.stringify(copiedManifest, null, 2) + '\n', 'utf8');
  }
  const backgroundPath = join(extensionCopy, 'background.js');
  await writeFile(backgroundPath, instrumentBackground(await readFile(backgroundPath, 'utf8')), 'utf8');
  return { canonicalVersion: sourceManifest.version, manifestVersion: targetManifestVersion, fileCount: extensionFiles.length, source: candidateSource,
    sha256: digest.digest('hex'), hashFormat: 'canonical filename + NUL + bytes + NUL, per file in pinned-ref order' };
}

function instrumentBackground(source) {
  const instrument = `
let qa076WriteQueue=Promise.resolve();
function qa076Record(kind,metadata){
 const job=qa076WriteQueue.then(async()=>{
  const stored=await chrome.storage.local.get(['qa076CallLog','qa076Phase']);
  const rows=Array.isArray(stored.qa076CallLog)?stored.qa076CallLog:[];
  rows.push({at:Date.now(),phase:stored.qa076Phase||'unknown',version:chrome.runtime.getManifest().version,kind,...metadata});
  await chrome.storage.local.set({qa076CallLog:rows.slice(-2000)});
 });
 qa076WriteQueue=job.catch(()=>{});
 return job.catch(()=>null);
}
function qa076TrackedTabsSendMessage(...args){
 const [tabId,message,options]=args;
 return qa076Record('tabs.sendMessage',{tabId,action:message?.action||null,options:options||null}).then(()=>chrome.tabs.sendMessage(...args));
}
function qa076TrackedExecuteScript(details){
 return qa076Record('scripting.executeScript',{tabId:details?.target?.tabId??null,target:details?.target||null,world:details?.world||null,files:details?.files||null,injectImmediately:details?.injectImmediately===true}).then(()=>chrome.scripting.executeScript(details));
}
`;
  const patched = source
    .replaceAll('chrome.tabs.sendMessage(', 'qa076TrackedTabsSendMessage(')
    .replaceAll('chrome.scripting.executeScript(', 'qa076TrackedExecuteScript(');
  if (patched === source || !patched.includes('qa076TrackedTabsSendMessage(') || !patched.includes('qa076TrackedExecuteScript(')) {
    throw new Error('Could not instrument both tabs.sendMessage and scripting.executeScript in the QA copy');
  }
  const insertionPoint = '(() => {';
  if (!patched.includes(insertionPoint)) throw new Error('Could not find background.js bundle wrapper for instrumentation');
  return patched.replace(insertionPoint, `${insertionPoint}\n${instrument}`);
}

function fixtureHtml(pathname) {
  const page = JSON.stringify(pathname);
  const video = pathname.startsWith('/video-') || pathname.startsWith('/bf-video-')
    ? '<video id="fixture" src="/tiny.webm" controls muted autoplay loop playsinline></video>' : '';
  return `<!doctype html><meta charset="utf-8"><title>QA-076 ${pathname}</title><main id="status">${pathname}</main>${video}<a id="qa076-open-new" href="/video-new" target="_blank">Open video in background</a><script>
window.__qa076={path:${page},token:crypto.randomUUID(),pageShows:[],pageHides:[]};
addEventListener('pageshow',event=>window.__qa076.pageShows.push({persisted:event.persisted,at:Date.now()}));
addEventListener('pagehide',event=>window.__qa076.pageHides.push({persisted:event.persisted,at:Date.now()}));
</script>`;
}

async function startServer() {
  const media = await readFile(join(projectRoot, 'tests/fixtures/tiny.webm'));
  server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', origin || 'http://127.0.0.1').pathname;
    if (pathname === '/tiny.webm') {
      response.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': media.length, 'Cache-Control': 'no-store' });
      response.end(media); return;
    }
    const body = fixtureHtml(pathname);
    const cache = pathname.startsWith('/bf-') ? 'public, max-age=600' : 'no-store';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': cache });
    response.end(body);
  });
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', resolveListen); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, server: 'node:http createServer', playwrightRoutesUsed: false, videoBytes: media.length };
}

function attachWorker(worker) {
  if (watchedWorkers.has(worker) || !worker.url().startsWith('chrome-extension://')) return;
  watchedWorkers.add(worker);
  events.workerEvents.push({ at: new Date().toISOString(), phase, event: 'started', url: worker.url() });
  worker.on('console', message => {
    if (message.type() === 'error') events.workerConsoleErrors.push({ at: new Date().toISOString(), phase, text: message.text(), location: message.location() });
  });
}

async function attachPage(page, label) {
  page.on('pageerror', error => events.pageErrors.push({ at: new Date().toISOString(), phase, label, message: error.message, stack: error.stack }));
  page.on('console', message => {
    if (message.type() === 'error') events.consoleErrors.push({ at: new Date().toISOString(), phase, label, text: message.text(), location: message.location() });
  });
  const session = await context.newCDPSession(page);
  session.on('Runtime.exceptionThrown', details => {
    const item = details.exceptionDetails || {};
    events.cdpExceptions.push({ at: new Date().toISOString(), phase, label, text: item.text, line: item.lineNumber, column: item.columnNumber,
      exception: item.exception?.description || item.exception?.value || null });
  });
  session.on('Runtime.executionContextCreated', ({ context: item }) => events.contexts.push({ at: new Date().toISOString(), phase, label, event: 'created', id: item.id, origin: item.origin, name: item.name, isDefault: item.auxData?.isDefault }));
  session.on('Runtime.executionContextDestroyed', item => events.contexts.push({ at: new Date().toISOString(), phase, label, event: 'destroyed', id: item.executionContextId }));
  session.on('Runtime.executionContextsCleared', () => events.contexts.push({ at: new Date().toISOString(), phase, label, event: 'cleared' }));
  await session.send('Runtime.enable');
  cdpSessions.push(session);
  return session;
}

async function workerFor(version = null) {
  return waitFor(async () => {
    const prefix = extensionId ? `chrome-extension://${extensionId}/` : 'chrome-extension://';
    for (const worker of context.serviceWorkers().filter(item => item.url().startsWith(prefix) && item.url().endsWith('/background.js')).reverse()) {
      attachWorker(worker);
      try { if (!version || await worker.evaluate(() => chrome.runtime.getManifest().version) === version) return worker; } catch {}
    }
    return null;
  }, `service worker ${version || ''}`, 20000);
}

async function extensionInfo() {
  return inspector.evaluate(async id => {
    const info = await chrome.developerPrivate.getExtensionInfo(id);
    return { state: info?.state, version: info?.version, errorCollection: info?.errorCollection,
      runtimeErrors: info?.runtimeErrors || [], runtimeWarnings: info?.runtimeWarnings || [] };
  }, extensionId);
}

async function loadInfoAtVersion(version) {
  return waitFor(async () => {
    const info = await extensionInfo();
    return info.state === 'ENABLED' && info.version === version ? info : null;
  }, `extension enabled at ${version}`, 20000);
}

async function clearRuntimeErrors() {
  const info = await extensionInfo();
  const ids = [...info.runtimeErrors, ...info.runtimeWarnings].map(item => item.id).filter(Number.isInteger);
  if (ids.length) await inspector.evaluate(({ id, errorIds }) => chrome.developerPrivate.deleteExtensionErrors({ extensionId: id, errorIds, type: 'RUNTIME' }), { id: extensionId, errorIds: ids });
  return waitFor(async () => {
    const after = await extensionInfo();
    return after.runtimeErrors.length === 0 && after.runtimeWarnings.length === 0 ? { removed: ids.length, after } : null;
  }, 'runtime errors and warnings cleared');
}

async function makePage(label, pathname) {
  const page = await context.newPage();
  await attachPage(page, label);
  await page.goto(`${origin}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__qa076);
  return page;
}

async function fixtureTabs(worker) {
  return worker.evaluate(base => chrome.tabs.query({}).then(tabs => tabs
    .filter(tab => tab.url?.startsWith(base))
    .map(({ id, url, active, status }) => ({ id, url, active, status }))), origin);
}

async function storageTrace(worker) {
  return worker.evaluate(() => chrome.storage.local.get(['qa076CallLog','qa076Phase']).then(result => ({
    phase: result.qa076Phase || null, calls: result.qa076CallLog || [],
  })));
}

async function activitySnapshot(worker) {
  return worker.evaluate(() => chrome.storage.session.get('tabActivity').then(result => result.tabActivity || null));
}

async function activityCheckpointSnapshot(worker) {
  return worker.evaluate(() => chrome.storage.local.get('tabActivityGrace').then(result => result.tabActivityGrace || null));
}

async function pageTabId(worker, page) {
  const url = page.url();
  return waitFor(async () => {
    const tabs = await fixtureTabs(worker);
    return tabs.find(tab => tab.url === url)?.id || null;
  }, `tab id for ${url}`);
}

async function waitForVideo(page, label, playing = false) {
  await page.waitForFunction(shouldPlay => {
    const video = document.querySelector('#fixture');
    return video && video.readyState >= 2 && (!shouldPlay || !video.paused && !video.ended);
  }, playing, { timeout: 12000 });
  return page.evaluate(() => {
    const video = document.querySelector('#fixture');
    return { readyState: video.readyState, paused: video.paused, playbackRate: video.playbackRate, duration: video.duration };
  });
}

async function sendRateCommand(popupPage, tabId, value) {
  const response = await popupPage.evaluate(({ tabId: targetTabId, value: requestedRate }) => new Promise(resolve => {
    chrome.runtime.sendMessage({ scope: 'video-control', tabId: targetTabId, action: 'command', command: 'set', value: requestedRate }, result => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : result);
    });
  }), { tabId, value });
  if (!response?.ok) throw new Error(`Control request failed for tab ${tabId}: ${JSON.stringify(response)}`);
  return response;
}

async function setAndVerifyRate(popupPage, page, tabId, value, label) {
  const response = await sendRateCommand(popupPage, tabId, value);
  await page.waitForFunction(expected => Math.abs(document.querySelector('#fixture')?.playbackRate - expected) < 0.001, value, { timeout: 10000 });
  const actual = await page.evaluate(() => document.querySelector('#fixture')?.playbackRate ?? null);
  return { label, tabId, requested: value, actual, response: response.result || response };
}

async function captureRateCheck(popupPage, page, tabId, value, label) {
  try { return { passed: true, ...await setAndVerifyRate(popupPage, page, tabId, value, label) }; }
  catch (error) { return { passed: false, label, tabId, requested: value, error: error?.message || String(error) }; }
}

async function focusForControl(worker,page,tabId){
  await page.bringToFront();
  await waitFor(async()=>(await activitySnapshot(worker))?.focusedTabId===tabId,'focus before manual control');
}

async function openBackgroundTabFrom(page, label) {
  await page.locator('#qa076-open-new').click({ button: 'middle', noWaitAfter: true });
  const created = await waitFor(() => context.pages().find(item => item.url().endsWith('/video-new')) || null, `background child tab for ${label}`, 12000, 100);
  if (!created) throw new Error(`No new tab appeared from ${label}`);
  await attachPage(created, label);
  await waitForVideo(created, label, false);
  return created;
}

async function setPhase(worker, value, clearTrace = false) {
  await worker.evaluate(({ phaseName, clear }) => chrome.storage.local.set(clear ? { qa076Phase: phaseName, qa076CallLog: [] } : { qa076Phase: phaseName }),
    { phaseName: value, clear: clearTrace });
}

async function waitForCallLogQuiet(worker, quietMs = 600, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  let previous = -1, quietSince = 0;
  while (Date.now() < end) {
    const snapshot = await storageTrace(worker);
    if (snapshot.calls.length !== previous) { previous = snapshot.calls.length; quietSince = Date.now(); }
    else if (quietSince && Date.now() - quietSince >= quietMs) return snapshot;
    await delay(100);
  }
  return storageTrace(worker);
}

async function safeRemoveProfile() {
  if (!temporaryRoot || !profilePath) return;
  const tempReal = await realpath(temporaryRoot);
  const osTempReal = await realpath(tmpdir());
  const rootRel = relative(osTempReal, tempReal);
  if (!basename(tempReal).startsWith('videospeed-qa076-') || !rootRel || rootRel === '..' || rootRel.startsWith(`..${sep}`) || isAbsolute(rootRel)) {
    throw new Error(`Refused profile cleanup: temp root is not a dedicated OS temp: ${tempReal}`);
  }
  const profileReal = await realpath(profilePath);
  requireInside(profileReal, tempReal, 'profile cleanup');
  if (basename(profileReal) !== 'profile') throw new Error(`Refused unexpected profile path: ${profileReal}`);
  await rm(profileReal, { recursive: true, force: true });
  profileRemoved = true;
  await rm(tempReal, { recursive: true, force: true });
}

let baselineGit = null, collectorBefore = null, activeTabsBeforeUpdate = null, updateInfoAfter = null;
let checkpointReloadEvidence = null, latestCandidateVersion = candidateVersion;
try {
  await mkdir(qaRoot, { recursive: true });
  baselineGit = await copyHeadExtension();
  const backgroundPath = join(extensionCopy, 'background.js');
  const originalBackground = await readFile(backgroundPath, 'utf8');
  await writeFile(backgroundPath, instrumentBackground(originalBackground), 'utf8');
  const probeFile = join(extensionCopy, 'qa076-probe.js');
  await writeFile(probeFile, `if(location.pathname==='/qa-076-probe')setTimeout(()=>{throw new Error(${JSON.stringify(marker)});},0);\n`, 'utf8');
  const manifestPath = join(extensionCopy, 'manifest.json');
  const manifestWithProbe = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifestWithProbe.version = oldManifestVersion;
  manifestWithProbe.content_scripts ||= [];
  manifestWithProbe.content_scripts.push({ matches: ['http://127.0.0.1/*'], js: ['qa076-probe.js'], run_at: 'document_start' });
  await writeFile(manifestPath, JSON.stringify(manifestWithProbe, null, 2) + '\n', 'utf8');

  temporaryRoot = await mkdtemp(join(tmpdir(), 'videospeed-qa076-'));
  profilePath = join(temporaryRoot, 'profile');
  await mkdir(profilePath, { recursive: true });
  const fixtureInfo = await startServer();
  const executablePath = executablePathHint;
  assert.ok(isAbsolute(executablePath), `Chromium executable path must be absolute: ${executablePath}`);
  await stat(executablePath);
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath, headless: true, ignoreDefaultArgs: ['--disable-extensions', '--disable-back-forward-cache', '--headless'],
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionCopy}`, `--load-extension=${extensionCopy}`, '--headless=new', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
  });
  browserVersion = context.browser()?.version() || null;
  context.on('serviceworker', attachWorker);
  const initialWorker = await workerFor(oldManifestVersion);
  extensionId = await initialWorker.evaluate(() => chrome.runtime.id);
  inspector = await context.newPage();
  await inspector.goto('chrome://extensions/');
  await inspector.evaluate(async () => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  await inspector.evaluate(async id => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, errorCollection: true }), extensionId);
  let info = await extensionInfo();
  if (info.errorCollection?.isEnabled !== true || info.errorCollection?.isActive !== true) throw new Error(`DeveloperPrivate collector inactive: ${JSON.stringify(info.errorCollection)}`);

  phase = 'collector-positive-probe';
  const probePage = await makePage('collector-probe', '/qa-076-probe');
  info = await waitFor(async () => {
    const current = await extensionInfo();
    return current.runtimeErrors.some(error => error.message?.includes(marker)) ? current : null;
  }, 'positive probe in developerPrivate.runtimeErrors');
  const probeErrors = info.runtimeErrors.filter(error => error.message?.includes(marker));
  positiveProbe = { collected: probeErrors.length > 0, errorCollection: info.errorCollection,
    errors: probeErrors.map(({ id, message, source, isServiceWorker, occurrences }) => ({ id, message, source, isServiceWorker, occurrences })) };
  await inspector.evaluate(({ id, errorIds }) => chrome.developerPrivate.deleteExtensionErrors({ extensionId: id, errorIds, type: 'RUNTIME' }),
    { id: extensionId, errorIds: probeErrors.map(error => error.id) });
  const afterDelete = await waitFor(async () => {
    const current = await extensionInfo();
    return current.runtimeErrors.some(error => error.message?.includes(marker)) ? null : current;
  }, 'positive probe cleared from developerPrivate');
  await probePage.close();

  phase = 'probe-cleanup-reload';
  const cleanManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  cleanManifest.content_scripts = cleanManifest.content_scripts.filter(item => !item.js?.includes('qa076-probe.js'));
  await writeFile(manifestPath, JSON.stringify(cleanManifest, null, 2) + '\n', 'utf8');
  await rm(probeFile, { force: true });
  const cleanupReload = await inspector.evaluate(async id => chrome.developerPrivate.reload(id, { failQuietly: true, populateErrorForUnpacked: true }), extensionId);
  if (cleanupReload) throw new Error(`Probe cleanup reload failed: ${JSON.stringify(cleanupReload)}`);
  info = await loadInfoAtVersion(oldManifestVersion);
  if (info.errorCollection?.isEnabled !== true || info.errorCollection?.isActive !== true) throw new Error(`Collector inactive after probe cleanup reload: ${JSON.stringify(info.errorCollection)}`);
  const cleanupClear = await clearRuntimeErrors();
  collectorBefore = cleanupClear.after;
  probeCleanup = { removedProbe: true, cleanupReload: 'ok', positiveProbeCountAfterDelete: afterDelete.runtimeErrors.filter(error => error.message?.includes(marker)).length,
    collectorStillActive: info.errorCollection?.isActive === true, clearedOtherRuntimeRecords: cleanupClear.removed };

  const versionPage = await context.newPage();
  await versionPage.goto('chrome://version/');
  commandLine = await versionPage.locator('#command_line').textContent().catch(() => null);
  if (!commandLine) throw new Error('Could not verify Chromium command line on chrome://version');
  if (/--disable-back-forward-cache/i.test(commandLine)) throw new Error('Chromium command line still contains --disable-back-forward-cache');
  await versionPage.close();

  phase = `${runMode}-fixtures`;
  const idlePages = [];
  for (let index = 0; index < 3; index++) idlePages.push(await makePage(`idle-${index}`, `/idle?tab=${index}`));
  const firstWorker = await workerFor(oldManifestVersion);
  await firstWorker.evaluate(async () => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: true, defaultMode: 'off', qualityEnabled: false }, qa076Phase: 'fixtures-ready', qa076CallLog: [] });
  });
  let foregroundPage, recentVideoPage = null, bfcacheControlPage = null;
  if (runMode === 'candidate') {
    recentVideoPage = await makePage('recent-video', '/video-recent');
    await waitForVideo(recentVideoPage, 'recent-video', true);
    await recentVideoPage.evaluate(() => document.querySelector('#fixture').pause());
    foregroundPage = await makePage('active-video', '/video-active');
    await waitForVideo(foregroundPage, 'active-video', true);
  } else foregroundPage = await makePage('foreground', '/foreground');
  await foregroundPage.bringToFront();
  const tabsAfterSwitch = await fixtureTabs(firstWorker);
  const idleTabIds = tabsAfterSwitch.filter(tab => /\/idle\?/.test(tab.url)).map(tab => tab.id);
  const foregroundTab = tabsAfterSwitch.find(tab => tab.url === foregroundPage.url());
  if (idleTabIds.length !== 3 || !foregroundTab || foregroundTab.active !== true || tabsAfterSwitch.filter(tab => /\/idle\?/.test(tab.url)).some(tab => tab.active)) {
    throw new Error(`Fixture tabs were not confirmed inactive after switching to foreground: ${JSON.stringify(tabsAfterSwitch)}`);
  }
  const visibilityBefore = await Promise.all(idlePages.map(page => page.evaluate(() => ({ path: location.pathname, visibilityState: document.visibilityState, token: window.__qa076?.token }))));
  phase = 'idle-wait-over-10s';
  await setPhase(firstWorker, phase);
  const idleWaitStarted = Date.now();
  await delay(10500);
  const idleWaitMs = Date.now() - idleWaitStarted;
  const oldActivitySnapshot = runMode === 'candidate' ? await activitySnapshot(firstWorker) : null;
  if (runMode === 'candidate') {
    await recentVideoPage.bringToFront();
    await delay(250);
    await foregroundPage.bringToFront();
    await delay(350);
  }
  activeTabsBeforeUpdate = await fixtureTabs(firstWorker);
  const oldActivityBeforeUpdate = runMode === 'candidate' ? await activitySnapshot(firstWorker) : null;
  const traceBeforeUpdate = await storageTrace(firstWorker);

  if (runMode === 'candidate') candidateBuild = await copyCandidateExtension();
  else {
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    oldManifest.version = candidateVersion;
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n', 'utf8');
  }
  phase = runMode === 'candidate' ? 'candidate-update' : 'baseline-update';
  await setPhase(firstWorker, phase, true);
  const reloadStartedAt = new Date().toISOString();
  const reloadResult = await inspector.evaluate(async id => {
    const error = await chrome.developerPrivate.reload(id, { failQuietly: true, populateErrorForUnpacked: true });
    return error ? { error } : { ok: true };
  }, extensionId);
  if (!reloadResult.ok) throw new Error(`${candidateVersion} ${runMode} update reload failed: ${JSON.stringify(reloadResult)}`);
  updateInfoAfter = await loadInfoAtVersion(candidateVersion);
  const updatedWorker = await workerFor();
  const updateTrace = await waitForCallLogQuiet(updatedWorker, 700, 15000);
  await delay(400);
  const postUpdateTabs = await fixtureTabs(updatedWorker);
  const activeVideoTabId = runMode === 'candidate' ? await pageTabId(updatedWorker, foregroundPage) : postUpdateTabs.find(tab => /\/foreground/.test(tab.url))?.id || null;
  const recentVideoTabId = recentVideoPage ? await pageTabId(updatedWorker, recentVideoPage) : null;
  const newActivitySnapshot = runMode === 'candidate' ? await activitySnapshot(updatedWorker) : null;
  const idleAfter = await Promise.all(idlePages.map(async page => ({ label: page.url(), ...(await page.evaluate(() => ({
    path: location.pathname, visibilityState: document.visibilityState, token: window.__qa076?.token,
    pageShowCount: window.__qa076?.pageShows?.length || 0,
  }))) })));
  const updatePhase = runMode === 'candidate' ? 'candidate-update' : 'baseline-update';
  const updateCalls = updateTrace.calls.filter(item => item.phase === updatePhase && item.at >= Date.parse(reloadStartedAt));
  const idleCallTargets = new Set(idleTabIds);
  const idleProbeCalls = updateCalls.filter(item => idleCallTargets.has(item.tabId));
  const perIdleTab = idleTabIds.map(tabId => ({ tabId, before: activeTabsBeforeUpdate.find(tab => tab.id === tabId) || null,
    after: postUpdateTabs.find(tab => tab.id === tabId) || null,
    probes: idleProbeCalls.filter(item => item.tabId === tabId).map(({ at, kind, action, target, world, files, url, active }) => ({ at, kind, action, target, world, files, url, active })) }));
  const perTargetTab = [
    ...(Number.isInteger(activeVideoTabId) ? [{ label: runMode === 'candidate' ? 'active-video' : 'foreground', tabId: activeVideoTabId }] : []),
    ...(Number.isInteger(recentVideoTabId) ? [{ label: 'recent-video', tabId: recentVideoTabId }] : []),
  ].map(({ label, tabId }) => ({ label, tabId, tab: postUpdateTabs.find(tab => tab.id === tabId) || null,
    calls: updateCalls.filter(item => item.tabId === tabId).map(({ at, kind, action, target, world, files }) => ({ at, kind, action, target, world, files })) }));
  finalExtensionInfo = await extensionInfo();
  updateEvidence = { mode: runMode, fromVersion: oldManifestVersion, toVersion: updateInfoAfter.version, manifestOnlyBump: runMode === 'baseline', candidateBuild,
    reloadResult, reloadStartedAt,
    idleWaitMs, tabsConfirmedBeforeUpdate: activeTabsBeforeUpdate, fixtureVisibilityBefore: visibilityBefore,
    oldActivityAfterIdleWait: oldActivitySnapshot, oldActivityBeforeUpdate, activityAfterUpdate: newActivitySnapshot,
    activeVideoTabId, recentVideoTabId, perTargetTab,
    traceCountBeforeUpdate: traceBeforeUpdate.calls.length, instrumentedCallsAfterUpdate: updateCalls.length,
    executeScriptCallsAfterUpdate: updateCalls.filter(item => item.kind === 'scripting.executeScript').length,
    sendMessageCallsAfterUpdate: updateCalls.filter(item => item.kind === 'tabs.sendMessage').length,
    idleProbeCallCount: idleProbeCalls.length, perIdleTab, tabsAfterUpdate: postUpdateTabs, fixturePagesAfterUpdate: idleAfter,
    runtimeErrors: finalExtensionInfo.runtimeErrors, runtimeWarnings: finalExtensionInfo.runtimeWarnings };

  if (runMode === 'candidate') {
    phase = 'candidate-active-recent-new-controls';
    await setPhase(updatedWorker, phase);
    let popupPage = await context.newPage();
    await attachPage(popupPage, 'control-popup');
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForFunction(() => document.readyState === 'complete');
    await foregroundPage.bringToFront();
    const activeControl = await captureRateCheck(popupPage, foregroundPage, activeVideoTabId, 1.5, 'active-video');
    await focusForControl(updatedWorker,recentVideoPage,recentVideoTabId);
    const recentControl = await captureRateCheck(popupPage, recentVideoPage, recentVideoTabId, 1.25, 'recent-video');
    await popupPage.close();

    let effectiveWorker = updatedWorker;
    let recentAfterCheckpointReload = { passed: false, label: 'recent-after-checkpoint-reload', error: 'checkpoint reload not completed' };
    let checkpointBeforeReload = null, checkpointAfterReload = null, sessionAfterReload = null;
    let checkpointReloadResult = null, checkpointReloadTrace = null, secondCandidateBuild = null;
    let checkpointReloadStartedAt = null, checkpointReloadVersion = null, checkpointReloadError = null;
    let checkpointReloadIdleCalls = [], checkpointRecentCalls = [];
    try {
      await recentVideoPage.bringToFront();
      await delay(150);
      await foregroundPage.bringToFront();
      await delay(150);
      checkpointBeforeReload = await waitFor(async () => {
        const snapshot = await activityCheckpointSnapshot(updatedWorker);
        const deadline = snapshot?.untilByTab?.[recentVideoTabId];
        return Number.isSafeInteger(deadline) && deadline > Date.now() ? { ...snapshot, recentDeadline: deadline } : null;
      }, 'local tabActivityGrace checkpoint for recently focused tab', 4000, 100);

      phase = 'candidate-checkpoint-reload';
      await setPhase(updatedWorker, phase, true);
      secondCandidateBuild = await copyCandidateExtension(candidateVersion+'.1');
      checkpointReloadStartedAt = new Date().toISOString();
      checkpointReloadResult = await inspector.evaluate(async id => {
        const error = await chrome.developerPrivate.reload(id, { failQuietly: true, populateErrorForUnpacked: true });
        return error ? { error } : { ok: true };
      }, extensionId);
      if (!checkpointReloadResult.ok) throw new Error(`${candidateVersion} to ${candidateVersion}.1 candidate update failed: ${JSON.stringify(checkpointReloadResult)}`);
      const checkpointReloadInfo = await loadInfoAtVersion(candidateVersion+'.1');
      checkpointReloadVersion = checkpointReloadInfo.version;
      effectiveWorker = await workerFor(candidateVersion+'.1');
      latestCandidateVersion = candidateVersion+'.1';
      checkpointReloadTrace = await waitForCallLogQuiet(effectiveWorker, 700, 12000);
      const reloadCalls = checkpointReloadTrace.calls.filter(item => item.phase === phase && item.at >= Date.parse(checkpointReloadStartedAt));
      checkpointReloadIdleCalls = reloadCalls.filter(item => idleCallTargets.has(item.tabId));
      checkpointRecentCalls = reloadCalls.filter(item => item.tabId === recentVideoTabId);
      checkpointAfterReload = await activityCheckpointSnapshot(effectiveWorker);
      sessionAfterReload = await activitySnapshot(effectiveWorker);
      phase = 'candidate-checkpoint-reload-control';
      await setPhase(effectiveWorker, phase);
      popupPage = await context.newPage();
      await attachPage(popupPage, 'checkpoint-reload-control-popup');
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
      await popupPage.waitForFunction(() => document.readyState === 'complete');
      await focusForControl(effectiveWorker,recentVideoPage,recentVideoTabId);
      recentAfterCheckpointReload = await captureRateCheck(popupPage, recentVideoPage, recentVideoTabId, 1.4, 'recent-after-checkpoint-reload');
      await popupPage.close();
    } catch (error) {
      checkpointReloadError = error?.message || String(error);
      try { await popupPage?.close(); } catch {}
    }
    const deadlineBeforeReload = checkpointBeforeReload?.recentDeadline ?? null;
    const deadlineAfterReload = checkpointAfterReload?.untilByTab?.[recentVideoTabId] ?? null;
    checkpointReloadEvidence = {
      fromVersion: candidateVersion, toVersion: checkpointReloadVersion || candidateVersion+'.1', manifestVersionBumpOnlyInQACopy: true,
      candidateBuild: secondCandidateBuild, checkpointBeforeReload, checkpointAfterReload, sessionAfterReload,
      sameCandidateBytesAsInitialUpdate: secondCandidateBuild?.sha256 === candidateBuild?.sha256,
      recentTabId: recentVideoTabId, deadlineBeforeReload, deadlineAfterReload,
      deadlineWasNotExtended: Number.isSafeInteger(deadlineBeforeReload) && Number.isSafeInteger(deadlineAfterReload) && deadlineAfterReload <= deadlineBeforeReload,
      remainingMsAtReload: Number.isSafeInteger(deadlineBeforeReload) ? deadlineBeforeReload - Date.parse(checkpointReloadStartedAt || new Date().toISOString()) : null,
      reloadResult: checkpointReloadResult, reloadStartedAt: checkpointReloadStartedAt,
      instrumentedCallsAfterReload: checkpointReloadTrace?.calls?.filter(item => item.phase === 'candidate-checkpoint-reload' && item.at >= Date.parse(checkpointReloadStartedAt || '')).length ?? null,
      idleProbeCallCount: checkpointReloadIdleCalls.length,
      recentTabUpdateCalls: checkpointRecentCalls,
      recentControl: recentAfterCheckpointReload, error: checkpointReloadError,
    };

    let newTabControl = { passed: false, label: 'new-background-video', error: 'new tab was not opened' };
    let newTabInfo = null, activityFromOpener = null;
    try {
      await focusForControl(effectiveWorker,foregroundPage,activeVideoTabId);
      const newPage = await openBackgroundTabFrom(foregroundPage, 'new-background-video');
      const newTabId = await pageTabId(effectiveWorker, newPage);
      newTabInfo = await effectiveWorker.evaluate(id => chrome.tabs.get(id).then(({ id: tabId, url, active, openerTabId }) => ({ tabId, url, active, openerTabId })), newTabId);
      activityFromOpener = await waitFor(async () => {
        const snapshot = await activitySnapshot(effectiveWorker);
        const until = snapshot?.untilByTab?.[newTabId];
        return Number.isFinite(until) && until > Date.now() ? { snapshot, until } : null;
      }, 'openFrom grace lease for background tab', 5000, 100);
      popupPage = await context.newPage();
      await attachPage(popupPage, 'new-tab-control-popup');
      await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
      await popupPage.waitForFunction(() => document.readyState === 'complete');
      await focusForControl(effectiveWorker,newPage,newTabId);
      newTabControl = await captureRateCheck(popupPage, newPage, newTabId, 1.75, 'new-background-video');
      postUpdateNewTab = { ...newTabInfo, openerLeaseUntil: activityFromOpener.until,
        openerLeaseMsAtObservation: activityFromOpener.until - Date.now(), openerMatchesActiveVideo: newTabInfo.openerTabId === activeVideoTabId };
      await popupPage.close();
    } catch (error) {
      postUpdateNewTab = { error: error?.message || String(error), tab: newTabInfo, openerLease: activityFromOpener };
      newTabControl = { passed: false, label: 'new-background-video', error: postUpdateNewTab.error };
      try { await popupPage?.close(); } catch {}
    }
    controlEvidence = { active: activeControl, recent: recentControl, newBackground: newTabControl,
      newTab: newTabInfo, openerLeaseUntil: activityFromOpener?.until ?? null,
      openerLeaseMsAtObservation: activityFromOpener ? activityFromOpener.until - Date.now() : null,
      openerMatchesActiveVideo: newTabInfo?.openerTabId === activeVideoTabId,
      recentAfterCheckpointReload };
  }

  phase = 'bfcache-roundtrip';
  const clearBeforeBfcache = await clearRuntimeErrors();
  const bfcachePath = runMode === 'candidate' ? '/bf-video-a' : '/bf-a';
  const bfcachePage = await makePage('bfcache-a', bfcachePath);
  if (runMode === 'candidate') {
    await waitForVideo(bfcachePage, 'bfcache-a', true);
    await bfcachePage.evaluate(() => document.querySelector('#fixture').pause());
  }
  const bfcacheToken = await bfcachePage.evaluate(() => window.__qa076.token);
  await bfcachePage.goto(`${origin}/bf-b`, { waitUntil: 'domcontentloaded' });
  await bfcachePage.waitForFunction(() => location.pathname === '/bf-b' && !!window.__qa076);
  const secondToken = await bfcachePage.evaluate(() => window.__qa076.token);
  const goBackStartedAt = new Date().toISOString();
  const goBack = await bfcachePage.goBack({ waitUntil: 'commit', timeout: 10000 }).then(() => ({ returned: true })).catch(error => ({ error: error.message }));
  await waitFor(async () => {
    if (!bfcachePage.url().endsWith(bfcachePath)) return null;
    return bfcachePage.evaluate(() => window.__qa076?.pageShows?.some(item => item.persisted === true) ? true : null);
  }, 'BFCache pageshow.persisted=true', 10000, 100).catch(() => null);
  await delay(200);
  let returnedPage = null;
  if (bfcachePage.url().endsWith(bfcachePath)) returnedPage = await bfcachePage.evaluate(() => ({ token: window.__qa076?.token, pageShows: window.__qa076?.pageShows || [], pageHides: window.__qa076?.pageHides || [], playbackRate: document.querySelector('#fixture')?.playbackRate ?? null }));
  const bfcacheSucceeded = returnedPage?.token === bfcacheToken && returnedPage.pageShows.some(item => item.persisted === true);
  await delay(800);
  const bfcacheInfo = await extensionInfo();
  let bfcacheReturnControl = null;
  if (runMode === 'candidate' && bfcacheSucceeded) {
    phase = 'candidate-bfcache-return-control';
    const bfcacheWorker = await workerFor(latestCandidateVersion);
    const bfcacheTabId = await pageTabId(bfcacheWorker, bfcachePage);
    const popupPage = await context.newPage();
    await attachPage(popupPage, 'bfcache-control-popup');
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await bfcachePage.bringToFront();
    bfcacheReturnControl = await captureRateCheck(popupPage, bfcachePage, bfcacheTabId, 2, 'bfcache-return');
    await popupPage.close();
  }
  bfcacheEvidence = { startedAt: goBackStartedAt, goBack: goBack?.error ? { error: goBack.error } : { returned: !!goBack },
    firstDocumentToken: bfcacheToken, secondDocumentToken: secondToken, returnedPage, pageshowPersistedTrue: bfcacheSucceeded,
    returnControl: bfcacheReturnControl,
    runtimeErrors: bfcacheInfo.runtimeErrors, runtimeWarnings: bfcacheInfo.runtimeWarnings,
    newRuntimeErrors: bfcacheInfo.runtimeErrors, newRuntimeWarnings: bfcacheInfo.runtimeWarnings,
    pageErrors: events.pageErrors.filter(item => item.at >= goBackStartedAt), consoleErrors: events.consoleErrors.filter(item => item.at >= goBackStartedAt),
    cdpExceptions: events.cdpExceptions.filter(item => item.at >= goBackStartedAt), workerConsoleErrors: events.workerConsoleErrors.filter(item => item.at >= goBackStartedAt),
    clearedRuntimeRecordsBeforeRun: clearBeforeBfcache.removed };

  fixtureEvidence = { server: fixtureInfo, browser: browserVersion, executablePath, commandLine, disableBackForwardCacheFlagAbsent: !commandLine || !/--disable-back-forward-cache/i.test(commandLine),
    baselineGit, extensionId, loadedExtensionFiles: extensionFiles.length, collectorBefore, tabsBeforeUpdate: tabsAfterSwitch };
  extensionVersion = finalExtensionInfo?.version || updateInfoAfter.version;
  if (!positiveProbe?.collected) throw new Error('DeveloperPrivate positive probe was not collected');
  if (idleWaitMs < 10000) throw new Error(`Idle wait lasted only ${idleWaitMs}ms`);
} catch (error) {
  fatal = { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null };
  try { finalExtensionInfo ||= inspector && extensionId ? await extensionInfo() : null; } catch {}
} finally {
  phase = 'cleanup';
  for (const session of cdpSessions) await session.detach().catch(() => {});
  try { await context?.close(); } catch {}
  if (server) await new Promise(done => server.close(done));
  try { await safeRemoveProfile(); } catch (error) { fatal ||= { name: 'CleanupError', message: error.message, stack: error.stack }; }
}

const candidateFailures = runMode === 'candidate' ? [
  updateEvidence?.idleProbeCallCount === 0 ? null : 'candidate probed inactive no-video tabs',
  controlEvidence?.active?.actual === 1.5 ? null : 'active tab rate control failed',
  controlEvidence?.recent?.actual === 1.25 ? null : 'recent tab rate control failed',
  checkpointReloadEvidence?.sameCandidateBytesAsInitialUpdate ? null : 'second update did not reuse identical candidate files',
  checkpointReloadEvidence?.deadlineWasNotExtended ? null : 'local tab activity deadline was missing or extended after the second update',
  checkpointReloadEvidence?.idleProbeCallCount === 0 ? null : 'second update probed inactive no-video tabs',
  checkpointReloadEvidence?.recentControl?.actual === 1.4 ? null : 'recent tab rate control failed after checkpoint reload',
  controlEvidence?.newBackground?.actual === 1.75 ? null : 'new background tab rate control failed',
  controlEvidence?.openerMatchesActiveVideo ? null : 'new background tab did not retain opener identity',
  bfcacheEvidence?.pageshowPersistedTrue ? null : 'BFCache restore not confirmed',
  bfcacheEvidence?.runtimeErrors?.length === 0 && bfcacheEvidence?.runtimeWarnings?.length === 0 ? null : 'runtime diagnostics were collected during BFCache',
  bfcacheEvidence?.returnControl?.actual === 2 ? null : 'returned BFCache page rate control failed',
].filter(Boolean) : [];
const rateSummary = check => check?.passed ? `${check.actual}×` : `failed (${check?.error || 'not verified'})`;

const report = {
  schema: 'qa-076-idle-lifecycle/v1', runMode, startedAt, finishedAt: new Date().toISOString(),
  environment: { browser: `Playwright ${browserLabel}`, browserLabel, browserVersion, extensionId, extensionVersion, executablePath: executablePathHint,
    isolatedProfileRoot: temporaryRoot, isolatedProfileRemoved: profileRemoved, commandLine, backForwardCacheDisableFlagAbsent: !commandLine || !/--disable-back-forward-cache/i.test(commandLine),
    fixtureServer: fixtureEvidence?.server || null },
  source: { baselineGit, candidateBuild, extensionFiles: extensionFiles.length, extensionCopy, testInstrumentation: ['chrome.scripting.executeScript', 'chrome.tabs.sendMessage'] },
  collector: { positiveProbe, afterProbeCleanup: probeCleanup },
  idleTabUpdate: updateEvidence,
  activeRecentAndNewTabControls: controlEvidence,
  activityCheckpointReload: checkpointReloadEvidence,
  postUpdateNewTab,
  candidateGate: { passed: candidateFailures.length === 0, failures: candidateFailures },
  bfcache: bfcacheEvidence,
  monitors: events,
  fatal,
  interpretation: fatal ? `${runMode} QA did not complete; use the saved evidence to identify the failed gate.`
    : runMode === 'candidate' ? updateEvidence?.idleProbeCallCount > 0
      ? `Candidate update unexpectedly made ${updateEvidence.idleProbeCallCount} instrumented API calls to inactive no-video fixture tabs.`
      : `Candidate updated from ${oldManifestVersion} to ${candidateVersion} without instrumented API calls to the confirmed inactive no-video tabs; candidate gate failures: ${candidateFailures.join('; ') || 'none'}.`
    : updateEvidence?.idleProbeCallCount > 0 ? `Baseline confirmed ${updateEvidence.idleProbeCallCount} instrumented API calls targeted inactive no-video fixture tabs during the 0.6.13 to ${candidateVersion} reload.`
      : 'Baseline completed without an instrumented update API call targeting the confirmed inactive no-video fixture tabs.',
};
await mkdir(qaRoot, { recursive: true });
const resultPath = join(qaRoot, `results-${outputName}.json`);
const reportPath = join(qaRoot, `report-${outputName}.md`);
await writeFile(resultPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
const summaryItems = runMode === 'candidate' ? [
  `- Baseline source: ${baselineGit?.fileCount ?? 'unknown'} tracked files from ${baselineGit?.ref || 'unknown'}; candidate manifest ${oldManifestVersion} to ${updateInfoAfter?.version || 'unknown'}; candidate files: ${candidateBuild?.fileCount ?? 'unknown'}, SHA-256 ${candidateBuild?.sha256 || 'unknown'} (canonical filename + NUL + bytes + NUL).`,
  `- Confirmed inactive no-video tabs probed during update: ${updateEvidence?.idleProbeCallCount ?? 'not measured'}; executeScript calls across all tabs: ${updateEvidence?.executeScriptCallsAfterUpdate ?? 'unknown'}.`,
  `- Active/recent target update calls: ${updateEvidence?.perTargetTab?.map(item => `${item.label}=${item.calls.length}`).join(', ') || 'not measured'}.`,
  `- Speed control: active ${rateSummary(controlEvidence?.active)}, recent ${rateSummary(controlEvidence?.recent)}, recent after checkpoint reload ${rateSummary(controlEvidence?.recentAfterCheckpointReload)}, new background tab ${rateSummary(controlEvidence?.newBackground)}.`,
  `- Checkpoint update: manifest ${candidateVersion} to ${checkpointReloadEvidence?.toVersion || 'not completed'}; local deadline before/after ${checkpointReloadEvidence?.deadlineBeforeReload ?? 'missing'}/${checkpointReloadEvidence?.deadlineAfterReload ?? 'missing'}; not extended ${checkpointReloadEvidence?.deadlineWasNotExtended ?? false}; idle probes ${checkpointReloadEvidence?.idleProbeCallCount ?? 'not measured'}.`,
  `- New background tab: opener matches active page ${controlEvidence?.openerMatchesActiveVideo ?? false}; recorded grace ${controlEvidence?.openerLeaseMsAtObservation ?? 'unknown'} ms.`,
  `- BFCache: ${bfcacheEvidence?.pageshowPersistedTrue ? 'pageshow.persisted=true' : 'not confirmed'}; new runtime errors/warnings after BFCache ${bfcacheEvidence?.runtimeErrors?.length ?? 'unknown'}/${bfcacheEvidence?.runtimeWarnings?.length ?? 'unknown'}; returned-page rate ${bfcacheEvidence?.returnControl?.actual ?? 'not verified'}×.`,
] : [
  `- Source: ${baselineGit?.fileCount ?? 'unknown'} tracked files copied from ${baselineGit?.ref || 'unknown'} at ${baselineGit?.relativeExtension || 'VideoSpeed/extension'}; source manifest ${baselineGit?.manifestVersion || 'unknown'}.`,
  `- Idle period after switching to a separate foreground page: ${updateEvidence?.idleWaitMs ?? 'not completed'} ms.`,
  `- Update probe calls targeting inactive no-video fixture tabs: ${updateEvidence?.idleProbeCallCount ?? 'not measured'} (${updateEvidence?.executeScriptCallsAfterUpdate ?? 'unknown'} executeScript calls across all tabs).`,
  `- BFCache unchecked runtime errors/warnings: ${(bfcacheEvidence?.runtimeErrors?.length ?? 'unknown')}/${(bfcacheEvidence?.runtimeWarnings?.length ?? 'unknown')}.`,
];
const md = [
  `# QA-076: idle tabs and BFCache lifecycle ${runMode} (${browserLabel})`, '',
  ...summaryItems,
  `- Browser: Playwright Chromium ${browserVersion || 'unknown'}; isolated profile removed: ${profileRemoved}; local HTTP server used: ${fixtureEvidence?.server?.playwrightRoutesUsed === false}.`,
  `- Collector positive probe: ${positiveProbe?.collected ? 'collected and cleared' : 'not confirmed'}; error collection remained active after cleanup: ${probeCleanup?.collectorStillActive ?? 'unknown'}.`,
  `- BFCache launch flag: --disable-back-forward-cache ${fixtureEvidence?.disableBackForwardCacheFlagAbsent === false ? 'was present' : 'was absent from chrome://version command line'}.`,
  `- Result: ${report.interpretation}`, '',
  `See [results-${outputName}.json](results-${outputName}.json) for full call targets, tab states, rate controls, collector records, console output, and CDP evidence.`, '',
].join('\n');
await writeFile(reportPath, md, 'utf8');
process.stdout.write(JSON.stringify({ results: resultPath, report: reportPath,
  positiveProbeCollected: !!positiveProbe?.collected, idleProbeCallCount: updateEvidence?.idleProbeCallCount ?? null,
  bfcachePersisted: bfcacheEvidence?.pageshowPersistedTrue ?? false, runtimeErrors: bfcacheEvidence?.runtimeErrors?.length ?? null,
  controlEvidence, candidateFailures,
  profileRemoved, fatal, interpretation: report.interpretation }, null, 2) + '\n');
if (fatal || !bfcacheEvidence?.pageshowPersistedTrue || !positiveProbe?.collected || candidateFailures.length) process.exitCode = 1;
