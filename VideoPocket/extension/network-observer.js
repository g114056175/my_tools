import {serviceForPage,serviceForCdn} from './social-sites.js';
import {networkMediaKind,networkHttpUrl} from './network-media.js';
const TTL = 2 * 60 * 1000;
const PER_TAB_CAP = 40;
const GLOBAL_CAP = 200;
const SAFE_REQUEST_HEADERS = new Set(["origin", "referer", "range"]);

function allowedUrlPatterns() {
  return [
    "*://*.fbcdn.net/*", "*://*.fbsbx.com/*", "*://*.facebook.com/*",
    "*://*.tiktokcdn.com/*", "*://*.tiktokcdn-us.com/*", "*://*.tiktokcdn-eu.com/*",
    "*://*.tiktokcdn-in.com/*", "*://*.tiktokv.com/*", "*://*.byteoversea.com/*",
    "*://*.ibytedtos.com/*", "*://*.ibyteimg.com/*", "*://*.muscdn.com/*", "*://*.tiktok.com/*",
  ];
}

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  return (headers || []).find((item) => String(item?.name || "").toLowerCase() === wanted)?.value || "";
}

function responseMime(details) {
  return headerValue(details.responseHeaders, "content-type");
}

function responseLength(details) {
  const value = headerValue(details.responseHeaders, "content-length");
  if(!value)return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function createNetworkMediaObserver(chrome, { now = () => Date.now(), socialOnly = false, demandOnly = false } = {}) {
  if (!chrome?.webRequest || !chrome?.tabs) throw new TypeError("Chrome webRequest and tabs APIs are required");
  const candidatesByTab = new Map();
  const pending = new Map();
  const pageUrls = new Map();
  const nonSocialTabs = new Set();
  const activeTabs = new Set();
  let disposed = false;
  let webRequestAttached = false;

  const prune = () => {
    const cutoff = now() - TTL;
    for (const [tabId, list] of candidatesByTab) {
      const fresh = list.filter((item) => item.time > cutoff);
      if (fresh.length) candidatesByTab.set(tabId, fresh);
      else candidatesByTab.delete(tabId);
    }
    for (const [key, item] of pending) if (item.time <= cutoff) pending.delete(key);
  };
  const totalCount = () => [...candidatesByTab.values()].reduce((sum, list) => sum + list.length, 0);
  const clearTab = (tabId) => {
    candidatesByTab.delete(tabId);
    for (const [key, item] of pending) if (item.tabId === tabId) pending.delete(key);
  };
  const pageService = (details) => {
    const candidates = [details?.initiator, details?.documentUrl, pageUrls.get(details?.tabId)];
    return [...new Set(candidates.map(serviceForPage).filter(Boolean))];
  };
  const requestContext = (details) => {
    if (!Number.isInteger(details?.tabId) || details.tabId < 0) return "";
    if(typeof details.url!=='string'||details.url.length>16384)return '';
    if(socialOnly&&nonSocialTabs.has(details.tabId))return '';
    if(!networkHttpUrl(details.url))return '';
    const cdn = serviceForCdn(details.url);
    const pages = pageService(details);
    return cdn && pages.includes(cdn) ? cdn : socialOnly ? "" : "generic";
  };
  const safeHeaders = (headers) => {
    const result = {};
    for (const item of headers || []) {
      const name = String(item?.name || "").toLowerCase();
      if (SAFE_REQUEST_HEADERS.has(name) && item?.value != null) result[name] = String(item.value).slice(0, 4096);
    }
    return result;
  };
  const addCandidate = (details, service, request, time = now()) => {
    prune();
    const item = {
      time, service, tabId: details.tabId, requestId: String(details.requestId || ""),
      frameId: Number.isInteger(details.frameId) ? details.frameId : undefined,
      documentId: details.documentId == null ? undefined : String(details.documentId),
      url: details.url, mime: responseMime(details), kind:networkMediaKind({url:details.url,mime:responseMime(details)}), contentLength: responseLength(details),
      originalUrl:request?.originalUrl || details.url,
      contentRange: headerValue(details.responseHeaders, "content-range") || undefined,
      method: request?.method || details.method || undefined,
      range: request?.headers?.range || undefined,
      origin: request?.headers?.origin || undefined,
      referer: request?.headers?.referer || undefined,
    };
    const list = candidatesByTab.get(details.tabId) || [];
    const existing = list.findIndex(old => old.url===item.url&&old.documentId===item.documentId&&old.frameId===item.frameId);
    if (existing >= 0) list.splice(existing, 1);
    list.push(item);
    while (list.length > PER_TAB_CAP) list.shift();
    candidatesByTab.set(details.tabId, list);
    while (totalCount() > GLOBAL_CAP) {
      const oldest = [...candidatesByTab.entries()].flatMap(([tabId, values]) => values.map((value, index) => ({ tabId, index, time: value.time }))).sort((a, b) => a.time - b.time)[0];
      if (!oldest) break;
      const values = candidatesByTab.get(oldest.tabId) || [];
      values.splice(oldest.index, 1);
      if (values.length) candidatesByTab.set(oldest.tabId, values); else candidatesByTab.delete(oldest.tabId);
    }
  };
  const onSendHeaders = (details) => {
    if (disposed) return;
    if (demandOnly && !activeTabs.has(details?.tabId)) return;
    prune();
    const service = requestContext(details);
    if (!service) return;
    pending.set(String(details.requestId), { time: now(), tabId: details.tabId, service, method: details.method, originalUrl:pending.get(String(details.requestId))?.originalUrl || details.url,headers: safeHeaders(details.requestHeaders) });
    while (pending.size > GLOBAL_CAP) pending.delete(pending.keys().next().value);
  };
  const onResponseStarted = (details) => {
    if (demandOnly && !activeTabs.has(details?.tabId)) { pending.delete(String(details?.requestId)); return; }
    prune();
    const request = pending.get(String(details?.requestId));
    pending.delete(String(details?.requestId));
    if(String(request?.method || details.method || 'GET').toUpperCase()!=='GET')return;
    if (disposed || ![200,206].includes(Number(details.statusCode)) || !networkMediaKind({url:details.url,mime:responseMime(details)})) return;
    const service = request?.service || requestContext(details);
    if (!service || (socialOnly && service!==requestContext(details))) return;
    addCandidate(details, service, request);
  };
  const onErrorOccurred = (details) => pending.delete(String(details?.requestId));
  const onUpdated = (tabId, changeInfo) => {
    if (disposed || !Number.isInteger(tabId) || tabId < 0) return;
    if (demandOnly && !activeTabs.has(tabId)) return;
    if (changeInfo?.url) {
      if (networkHttpUrl(changeInfo.url)){pageUrls.set(tabId,new URL(changeInfo.url).origin);if(serviceForPage(changeInfo.url))nonSocialTabs.delete(tabId);else nonSocialTabs.add(tabId);}
      else{pageUrls.delete(tabId);nonSocialTabs.add(tabId);}
      clearTab(tabId);
      return;
    }
    if (changeInfo?.status === "loading") clearTab(tabId);
  };
  const onRemoved = (tabId) => {
    activeTabs.delete(tabId);
    pageUrls.delete(tabId);nonSocialTabs.delete(tabId); clearTab(tabId);
    if (demandOnly && !activeTabs.size) detachWebRequest();
  };

  const sendHeadersSpec = ["requestHeaders", "extraHeaders"];
  const requestFilter={urls:socialOnly?allowedUrlPatterns():["http://*/*","https://*/*"],...(!socialOnly?{types:['media','xmlhttprequest','other']}:{})};
  const attachWebRequest = () => {
    if (disposed || webRequestAttached) return;
    try {
      chrome.webRequest.onSendHeaders.addListener(onSendHeaders, requestFilter, sendHeadersSpec);
    } catch {
      chrome.webRequest.onSendHeaders.addListener(onSendHeaders, requestFilter, ["requestHeaders"]);
    }
    chrome.webRequest.onResponseStarted.addListener(onResponseStarted, requestFilter, ["responseHeaders"]);
    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, requestFilter);
    webRequestAttached = true;
  };
  function detachWebRequest() {
    if (!webRequestAttached) return;
    chrome.webRequest.onSendHeaders.removeListener(onSendHeaders);
    chrome.webRequest.onResponseStarted.removeListener(onResponseStarted);
    chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
    webRequestAttached = false;
    pending.clear();
  }
  if (!demandOnly) attachWebRequest();
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);

  const candidates = ({ tabId, documentId, frameId, pageUrl } = {}) => {
    prune();
    if (!Number.isInteger(tabId) || tabId < 0) return [];
    if (demandOnly && !activeTabs.has(tabId)) return [];
    if(socialOnly&&nonSocialTabs.has(tabId))return [];
    const currentService = serviceForPage(pageUrls.get(tabId));
    if(socialOnly&&pageUrls.has(tabId)&&!currentService)return [];
    if(pageUrl&&pageUrls.has(tabId)){try{if(new URL(pageUrl).origin!==pageUrls.get(tabId))return [];}catch{return [];}}
    const service = serviceForPage(pageUrl || pageUrls.get(tabId));
    if(socialOnly&&(!service||(pageUrl&&currentService&&currentService!==service)))return [];
    return (candidatesByTab.get(tabId) || []).filter((item) =>
      (!socialOnly || item.service === service) &&
      (documentId == null || String(item.documentId || "") === String(documentId)) &&
      (frameId == null || Number(item.frameId) === Number(frameId))
    ).map((item) => ({ ...item }));
  };
  const enableTab = tabId => {
    if (disposed || !Number.isInteger(tabId) || tabId < 0) return false;
    const wasActive = activeTabs.has(tabId);
    activeTabs.add(tabId);
    if (demandOnly && !wasActive) attachWebRequest();
    return true;
  };
  const disableTab = tabId => {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    const wasActive = activeTabs.delete(tabId);
    clearTab(tabId); pageUrls.delete(tabId); nonSocialTabs.delete(tabId);
    if (demandOnly && !activeTabs.size) detachWebRequest();
    return wasActive;
  };
  const seed = (tabId, items) => {
    if (disposed || !Number.isInteger(tabId) || tabId < 0 || (demandOnly && !activeTabs.has(tabId)) || !Array.isArray(items)) return 0;
    const at = now(), cutoff = at - TTL, seeds = [];
    for (const entry of items.slice(-GLOBAL_CAP)) {
      const url = networkHttpUrl(entry?.url), pageUrl = networkHttpUrl(entry?.pageUrl);
      const time = entry?.timeStamp, frameId = entry?.frameId, documentId = entry?.documentId;
      if (!url || !pageUrl || !Number.isFinite(time) || time <= cutoff || time > at ||
          !Number.isInteger(frameId) || frameId < 0 || typeof documentId !== 'string' || !documentId || documentId.length > 256) continue;
      const details = {tabId, url, initiator: pageUrl, documentUrl: pageUrl, frameId, documentId, responseHeaders: []};
      const service = requestContext(details);
      if (!service || !networkMediaKind({url})) continue;
      seeds.push({details, service, time});
    }
    seeds.sort((a, b) => a.time - b.time);
    let count = 0;
    for (const {details, service, time} of seeds) {
      if (details.frameId === 0) {
        const pageUrl = details.documentUrl;
        pageUrls.set(tabId, new URL(pageUrl).origin);
        if (serviceForPage(pageUrl)) nonSocialTabs.delete(tabId); else nonSocialTabs.add(tabId);
      }
      addCandidate(details, service, undefined, time); count++;
    }
    return count;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    detachWebRequest();
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    candidatesByTab.clear(); pending.clear(); pageUrls.clear();nonSocialTabs.clear();activeTabs.clear();
  };
  return { candidates, enableTab, disableTab, seed, dispose, debug: () => ({ pendingCount: pending.size, tabCount: candidatesByTab.size, activeTabCount: activeTabs.size, webRequestAttached }) };
}
