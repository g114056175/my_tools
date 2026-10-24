import {
  collectMediaEvidence,
  exposeSourceEvidence,
  mediaElementSource,
} from "./media-evidence.js";
import { createMediaModelStore, extractMediaModels } from "./media-models.js";
import { selectedMediaHint } from "./media-binding.js";
import { observeWorkerMetadata } from "./worker-media.js";
import { observeJsonMetadata, copyMediaMetadata } from "./json-media-observer.js";
import {hasMediaPayload,isMediaPayloadText,isStrongMediaField,isBroadcastIdentityField} from './media-schema.js';
import { dailymotionContext } from "./dailymotion.js";
import {titleFor,isGenericMediaTitle} from './media-titles.js';
import {extractTwitchPlayerMetadata} from './twitch-clips.js';
import {BUILD_ID} from './build-info.js';

const OBSERVER_SYMBOL = Symbol.for("video-pocket.mediaObserver");
const MAX_GRAPH = 512,
  MAX_OBJECT_URLS = 256,
  MAX_TEXT = 512 * 1024,
  MAX_MANIFESTS = 12,
  MAX_MANIFEST_ALIASES = 48,
  MAX_MANIFEST_BYTES = 2 * 1024 * 1024,
  MANIFEST_TTL = 120 * 1000,
  TTL = 5 * 60 * 1000;
const http = (raw, base = "") => {
  try {
    const u = new URL(raw, base || undefined);
    return /^https?:$/.test(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
};
// The observer is injected at document_start on ordinary pages so it can see
// player metadata before a SPA replaces it.  Cloudflare's challenge frames
// are not media pages, and their bootstrap code deliberately uses restricted
// URL schemes.  Installing hooks there only adds work and can make the
// challenge console look as if the extension caused its CSP diagnostics.
export const shouldInstallMediaObserver = (target = globalThis) => {
  try {
    const hostname = String(target.location?.hostname || new URL(target.location?.href || "").hostname).toLowerCase();
    return !(
      hostname === "challenges.cloudflare.com" ||
      hostname.endsWith(".challenges.cloudflare.com")
    );
  } catch {
    return true;
  }
};
const isM3u8 = (u, type = "") =>
  /m3u8|mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(u);
const isMpd = (u, type = "") =>
  /dash|mpd/i.test(type) || /\.mpd(?:[?#]|$)/i.test(u);
const isManifest = (u, type = "") => isM3u8(u, type) || isMpd(u, type);
const isProgressive = (u, type = "") =>
  /video\//i.test(type) || /\.(?:mp4|webm|mov|m4v|mkv)(?:[?#]|$)/i.test(u);
const isSegment = (u) => /\.(?:ts|m4s|aac|m4a)(?:[?#]|$)/i.test(u);

// Relay/GraphQL can deliver several JSON records instead of one JSON body.
// This parser never evaluates script text or guesses URLs from unrelated text.
function boundedMetadataText(text) {
  if (typeof text !== 'string') return '';
  if (text.length <= MAX_TEXT) return text;
  // A large feed response can contain a small, complete video record before
  // unrelated deferred records. Keep complete records inside the original
  // read budget; never parse a truncated record or scan the oversized tail.
  const prefix = text.slice(0, MAX_TEXT);
  const newline = prefix.lastIndexOf('\n');
  return newline < 0 ? '' : prefix.slice(0, newline);
}
// Retention priority only: this does not admit or bind a source. Real playback
// values outrank feed records containing empty delivery fields/player IDs.
function metadataPriority(text) {
  for(const match of text.matchAll(/"([^"\\]{1,64})"\s*:\s*"(https?:|<|#EXTM3U)/g))
    if(isStrongMediaField(match[1])||/^(?:hls|dash)$/.test(match[1]))return 1;
  for(const match of text.matchAll(/"([^"\\]{1,64})"\s*:\s*"([^"\\]{1,256})"/g))
    if(isBroadcastIdentityField(match[1]))return 1;
  return 0;
}
export function mediaModelsFromText(text,baseUrl='',parseJson=JSON.parse){
  text=boundedMetadataText(text);
  if(!text)return [];
  const clean=text.replace(/^\s*for\s*\(;;\);\s*/,''),models=[];
  try{return extractMediaModels(parseJson(clean),{baseUrl});}catch{}
  for(const line of clean.split(/\r?\n/).slice(0,256)){
    const record=line.trim().replace(/^for\s*\(;;\);\s*/,'');
    if(!/^[\[{]/.test(record))continue;
    try{models.push(...extractMediaModels(parseJson(record),{baseUrl}));}catch{}
    if(models.length>=128)break;
  }
  return models.slice(0,128);
}

export function installMediaObserver(target = globalThis, options = {}) {
  const previous = target[OBSERVER_SYMBOL];
  if (previous?.sourcesFor && previous.build === BUILD_ID) return previous;
  // Extension reloads do not remove hooks from existing MAIN-world pages.
  // Restore the old hooks before installing this build, avoiding stacked
  // JSON/fetch wrappers and the silent reuse of obsolete parsing rules.
  if (previous?.sourcesFor) previous.dispose?.();
  if (!shouldInstallMediaObserver(target)) {
    const api = {
      build: BUILD_ID,
      sourcesFor: () => ({ candidates: [], pending: false, reason: "excluded-context" }),
      manifestFor: () => null,
      modelFor: () => null,
      diagnosticsFor: () => ({ excluded: true }),
      pageContext: () => null,
      scanDocument: () => [],
      dispose: () => {},
    };
    try { target[OBSERVER_SYMBOL] = api; } catch {}
    return api;
  }
  const bodyUrl = new WeakMap(),
    xhrUrls = new WeakMap(),
    bufferUrl = new WeakMap(),readerUrls=new WeakMap();
  const objectUrls = new Map(),
    graph = new Map(),
    patterns = [],
    known = new Map(),
    manifests = new Map(),
    manifestAliases = new Map(),
    mediaSources = new WeakMap(),
    sourceBuffers = new WeakMap(),
    wrappers = [];
  const parseJson=target.JSON?.parse || JSON.parse;
  const modelStore = createMediaModelStore({parseJson,target});
  const videoRegistry=new Set();let videoRegistryObserver,shadowRestore;
  const shadowRoots=new Set(),walkQueue=[];let walkScheduled=false,walkNodes=0;
  const registerVideo=node=>{try{if(node?.tagName==='VIDEO')videoRegistry.add(node);while(videoRegistry.size>512)videoRegistry.delete(videoRegistry.values().next().value);}catch{}};
  const enqueueShadowRoot=root=>{if(!root||shadowRoots.has(root))return;shadowRoots.add(root);try{videoRegistryObserver?.observe?.(root,{childList:true,subtree:true});}catch{}walkQueue.push({root,node:root});scheduleWalk();};
  const visitNode=node=>{if(!node)return;registerVideo(node);try{if(node.shadowRoot)enqueueShadowRoot(node.shadowRoot);}catch{}};
  const clock=()=>typeof target.performance?.now==='function'?target.performance.now():Date.now();
  const walkBatch=()=>{walkScheduled=false;const deadline=clock()+8;let n=0;
    while(walkQueue.length&&n++<256&&clock()<deadline){const item=walkQueue[0];
      if(!item.started){item.started=true;visitNode(item.node);try{item.walker=target.document.createTreeWalker?.(item.node,1);}catch{}item.count=1;}
      const node=item.walker?.nextNode();
      if(node&&item.count++<8192){visitNode(node);walkNodes++;}else{
        walkQueue.shift();
        // Tiny non-browser test DOMs do not implement TreeWalker.
        if(!item.walker)for(const child of Array.from(item.node?.children||[]).slice(0,64))if(walkQueue.length<64)walkQueue.push({node:child});
      }
    }if(walkQueue.length)scheduleWalk();};
  const scheduleWalk=()=>{if(walkScheduled)return;walkScheduled=true;(target.setTimeout||globalThis.setTimeout)?.(walkBatch,0);};
  try{
    const attach=target.Element?.prototype?.attachShadow;
    if(typeof attach==='function'){const wrapped=function(...args){const root=attach.apply(this,args);enqueueShadowRoot(root);return root;};target.Element.prototype.attachShadow=wrapped;shadowRestore=()=>{if(target.Element.prototype.attachShadow===wrapped)target.Element.prototype.attachShadow=attach;};}
    const root=target.document.documentElement||target.document;shadowRoots.add(root);walkQueue.push({root,node:root});scheduleWalk();
    if(target.MutationObserver){videoRegistryObserver=new target.MutationObserver(records=>{let count=0;for(const record of records){for(const node of record.addedNodes||[]){visitNode(node);if(walkQueue.length<64)walkQueue.push({node});if(++count>=256)break;}if(count>=256)break;}scheduleWalk();});videoRegistryObserver.observe(root,{childList:true,subtree:true});for(const shadowRoot of shadowRoots)if(shadowRoot!==root)try{videoRegistryObserver.observe(shadowRoot,{childList:true,subtree:true});}catch{}}
  }catch{}
  let pendingMetadata=0,pendingManifest=0,disposed=false,manifestBytes=0;
  const deferredMetadata=[];const MAX_DEFERRED_METADATA=32,MAX_DEFERRED_BYTES=2*1024*1024,DEFERRED_TTL=10*60*1000;
  let deferredBytes=0,deferredGeneration=0,lastDrainGeneration=0;
  const metadataReaders=new Set();
  const manifestReaders=new Set();
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const kindOf = (url, type = "") =>
    isM3u8(url, type)
      ? "hls"
      : isMpd(url, type)
        ? "dash"
        : isProgressive(url, type)
          ? "progressive"
          : "network";
  const prune = () => {
    const cutoff = now() - TTL;
    for (const [url, value] of known)
      if (!value.active && value.at < cutoff) known.delete(url);
    for (const [url, parents] of graph) {
      for (const parent of parents)
        if (!known.has(parent)) parents.delete(parent);
      if (!parents.size && !known.has(url)) graph.delete(url);
    }
    while (known.size > MAX_GRAPH) known.delete(known.keys().next().value);
    while (graph.size > MAX_GRAPH) graph.delete(graph.keys().next().value);
    while (patterns.length > MAX_GRAPH) patterns.shift();
    for (const [url, value] of objectUrls)
      if (value.revoked && value.at < cutoff) objectUrls.delete(url);
    for (const [url, value] of manifests) {
      if (value.at < now() - MANIFEST_TTL) {
        manifests.delete(url);
        manifestBytes -= value.text.length * 2;
      }
    }
    for (const [alias, url] of manifestAliases)
      if (!manifests.has(url)) manifestAliases.delete(alias);
  };
  const rememberManifest = (rawUrl, text, type = "", aliases = []) => {
    const url = http(rawUrl);
    if (!url || typeof text !== "string" || text.length > MAX_TEXT) return;
    // Keep Dailymotion's historical narrow retrieval policy. Other pages can
    // retain a bounded manifest already delivered by any HTTP(S) CDN.
    try {
      const pageHost = new URL(target.location?.href || "").hostname;
      const pageIsDailymotion = /(^|\.)dailymotion\.com$/i.test(pageHost);
      const urlIsDailymotion = isOfficialManifestHost(url);
      if (pageIsDailymotion ? !urlIsDailymotion : urlIsDailymotion) return;
    } catch {}
    const hls = isM3u8(url, type) || /^\s*#EXTM3U\b/m.test(text);
    const mpd = isMpd(url, type) || /<MPD\b/i.test(text);
    if ((!hls && !mpd) || (hls && !/^\s*#EXTM3U\b/m.test(text)) || (mpd && !/<MPD\b/i.test(text))) return;
    if (hls) {
      const media = /#EXTINF\s*:/i.test(text) || /#EXT-X-TARGETDURATION\s*:/i.test(text);
      if (media && !/#EXT-X-ENDLIST\b/i.test(text)) return;
    } else if (/\btype\s*=\s*["']dynamic["']/i.test(text) || /\bminimumUpdatePeriod\s*=/i.test(text)) return;
    prune();
    const old = manifests.get(url);
    if (old) manifestBytes -= old.text.length * 2;
    manifests.delete(url);
    manifestBytes += text.length * 2;
    manifests.set(url, {url, text, type: hls ? "hls" : "dash", at: now()});
    for (const alias of [rawUrl, ...aliases]) {
      const key = http(alias);
      if (key) manifestAliases.set(key, url);
    }
    while (manifestAliases.size > MAX_MANIFEST_ALIASES)
      manifestAliases.delete(manifestAliases.keys().next().value);
    while (manifests.size > MAX_MANIFESTS || manifestBytes > MAX_MANIFEST_BYTES) {
      const first = manifests.keys().next().value;
      const value = manifests.get(first);
      manifests.delete(first);
      for (const [alias, targetUrl] of manifestAliases)
        if (targetUrl === first) manifestAliases.delete(alias);
      manifestBytes -= (value?.text.length || 0) * 2;
    }
  };
  const manifestFor = rawUrl => {
    prune();
    const key = http(rawUrl), url = manifestAliases.get(key) || key, value = manifests.get(url);
    return value ? {url: value.url, text: value.text, type: value.type} : null;
  };
  const touch = (url, type = "", active = false) => {
    if (!url) return;
    const old = known.get(url);
    if (old) known.delete(url);
    known.set(url, {
      url,
      kind: type ? kindOf(url, type) : old?.kind || kindOf(url),
      manifest: isManifest(url, type) || !!old?.manifest,
      at: now(),
      active: active || !!old?.active,
    });
    prune();
  };
  const addEdge = (child, parent, type = "") => {
    child=String(child).replace(/&amp;/g,'&').replace(/&quot;/g,'"');
    child = http(child, parent);
    parent = http(parent);
    if (!child || !parent) return;
    const parents = graph.get(child) || new Set();
    parents.add(parent);
    while(parents.size>8)parents.delete(parents.values().next().value);
    graph.set(child, parents);
    touch(child, type);
    touch(parent, "", true);
    while (graph.size > MAX_GRAPH) {
      const stale = [...graph].find(([u]) => !known.get(u)?.active);
      if (!stale) break;
      graph.delete(stale[0]);
    }
  };
  const rememberBody = (body, url, type = "") => {
    try {
      if (body && (typeof body === "object" || typeof body === "function")) {
        bodyUrl.set(body, url);
        touch(url, type);
      }
    } catch {}
  };
  const sourceOf = (value) => {
    try {
      return (
        value &&
        (bufferUrl.get(value) ||
          bodyUrl.get(value) ||
          (value.buffer &&
            (bufferUrl.get(value.buffer) || bodyUrl.get(value.buffer))))
      );
    } catch {
      return "";
    }
  };
  const parseText = (text, url, type = "") => {
    try {
      if (typeof text !== "string" || text.length > MAX_TEXT) return;
      const hls = isM3u8(url, type) || /^\s*#EXTM3U\b/m.test(text);
      const mpd = isMpd(url, type) || /<MPD\b/i.test(text);
      if (!hls && !mpd) return;
      touch(
        url,
        type ||
          (mpd ? "application/dash+xml" : "application/vnd.apple.mpegurl"),
        true,
      );
      if (hls && !/^\s*#EXTM3U\b/m.test(text)) return;
      if (mpd && !/<MPD\b/i.test(text)) return;
      rememberManifest(url, text, type);
      if (hls)
        for (const line of text.split(/\r?\n/)) {
          const value = line.trim();
          if (value && !value.startsWith("#")) addEdge(value, url);
          else if(/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|MAP):/.test(value))for(const match of value.matchAll(/\bURI="([^"]+)"/g))addEdge(match[1],url);
        }
      else {
        for (const m of text.matchAll(
          /(?:media|initialization|sourceURL|BaseURL)\s*=\s*["']([^"']+)["']/gi,
        ))
          addEdge(m[1], url);
        for (const m of text.matchAll(/<BaseURL[^>]*>([^<]+)</gi))
          addEdge(m[1].trim(), url);
        for (const m of text.matchAll(
          /<SegmentTemplate\b[^>]*\bmedia=["']([^"']+)["'][^>]*>/gi,
        )) {
          const raw = http(m[1], url);
          if (!raw) continue;
          while(patterns.length>=MAX_GRAPH)patterns.shift();
          const token = "__VP_SEGMENT_TOKEN__";
          const templated = raw.replace(
            /\$(?:Number|Time|RepresentationID|Bandwidth)(?:%0\d+d)?\$/g,
            token,
          );
          const escaped = templated
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replaceAll(token, "[^/?#]+");
          try {
            patterns.push({ regex: new RegExp(`^${escaped}$`), parent: url });
          } catch {}
        }
      }
    } catch {}
  };
  const responseType = (response) => {
    try {
      return response?.headers?.get?.("content-type") || "";
    } catch {
      return "";
    }
  };
  const responseSucceeded = response => {
    try {
      if (response?.ok === false) return false;
      return typeof response?.status !== "number" || response.status < 400;
    } catch { return false; }
  };
  const recordJson = (value, url) => {
    try { modelStore.merge(extractMediaModels(value, { baseUrl: url })); } catch {}
  };
  const recordText=(value,url)=>{try{modelStore.merge(mediaModelsFromText(value,url,parseJson));}catch{}};
  const deferMetadata=(value,url,kind='json')=>{
    // Deferred parsing must not let unrelated API/analytics traffic evict
    // the one playback response needed by a later user selection.
    if(kind==='text'){
      value=boundedMetadataText(value);
      if(!value)return;
      const lines=value.split(/\r?\n/,256);
      const first=lines.find(line=>line.trim())?.trim().replace(/^for\s*\(;;\);\s*/,'') || '';
      if(lines.length>1&&/^(?:\{.*\}|\[.*\])$/.test(first)){
        // Relay repeats records across stream chunks and the final body.
        // Queue only media-bearing records, with stable per-record hashes;
        // otherwise unrelated feed text and overlapping copies evict the
        // selected video's metadata before the popup is opened.
        for(const line of lines)if(isMediaPayloadText(line))deferMetadata(line,url,'text');
        return;
      }
    }
    let snapshot,serialized;
    if(kind==='text'){
      value=boundedMetadataText(value);
      if(!value||!isMediaPayloadText(value))return;
      snapshot=serialized=value;
    }else{
      snapshot=copyMediaMetadata(value);if(!hasMediaPayload(snapshot))return;
      try{serialized=JSON.stringify(snapshot);}catch{return;}
    }
    const bytes=serialized.length*2;
    if(!bytes||bytes>MAX_DEFERRED_BYTES)return;
    let hash=2166136261;for(let i=0;i<serialized.length;i++)hash=Math.imul(hash^serialized.charCodeAt(i),16777619);
    const fingerprint=`${bytes}:${hash>>>0}`;
    const at=now();
    if(deferredMetadata.some(item=>item.at>=at-DEFERRED_TTL&&item.url===url&&item.kind===kind&&item.fingerprint===fingerprint&&(kind==='text'?item.value:JSON.stringify(item.value))===serialized))return;
    const priority=metadataPriority(serialized);
    while(deferredMetadata.length&&(deferredMetadata.length>=MAX_DEFERRED_METADATA||deferredBytes+bytes>MAX_DEFERRED_BYTES)){
      const lowest=Math.min(...deferredMetadata.map(item=>item.priority));
      if(lowest>priority)return;
      const index=deferredMetadata.findIndex(item=>item.priority===lowest);
      deferredBytes-=deferredMetadata.splice(index,1)[0].bytes;
    }
    const generation=++deferredGeneration;
    deferredMetadata.push({value:snapshot,url,kind,bytes,at,generation,fingerprint,priority});deferredBytes+=bytes;
  };
  const drainMetadata=(limit=8,budget,selectedVideo)=>{
    let count=0;const cutoff=now();
    const state=()=>({count,queued:deferredMetadata.length,bytes:deferredBytes,generation:lastDrainGeneration});
    if(!deferredMetadata.length||(budget&&!budget()))return state();
    let reserved=true;
    const matches=selectedMediaHint(selectedVideo,{pageUrl:target.location?.href});
    // Compute hints once per bounded queue entry. Priority is not evidence of
    // ownership: modelFor still checks the selected player's exact identity.
    const ordered=selectedVideo?deferredMetadata.map(item=>({item,priority:2*Number(matches(item.url)||matches(item.kind==='text'?item.value:JSON.stringify(item.value)))+item.priority})).sort((a,b)=>b.priority-a.priority).map(entry=>entry.item):deferredMetadata;
    while(ordered.length&&count<Math.max(1,Math.min(32,Number(limit)||8))&&(reserved||!budget||budget())){
      reserved=false;
      const item=ordered[0],index=deferredMetadata.indexOf(item);if(index>=0){deferredMetadata.splice(index,1);deferredBytes-=item.bytes;}if(ordered!==deferredMetadata)ordered.shift();
      if(item.at<cutoff-DEFERRED_TTL)continue;
      if(item.kind==='text')recordText(item.value,item.url);else recordJson(item.value,item.url);
      lastDrainGeneration=Math.max(lastDrainGeneration,item.generation);count++;
    }
    return state();
  };
  const jsonMetadata=observeJsonMetadata(target,value=>deferMetadata(value,target.location?.href,'json'));
  wrappers.push(()=>jsonMetadata.dispose());
  // Workers are a shared boundary on many players. Observe bounded metadata
  // on ordinary pages too; modelFor still requires an exact player identity,
  // so worker timing alone can never bind a source to a video.
  try{wrappers.push(observeWorkerMetadata(target,value=>{
    if(typeof value==='string')deferMetadata(value,target.location.href,'text');
    else deferMetadata(value,target.location.href,'json');
  },{metadataOnly:true,maxDepth:8,maxNodes:512,maxCharacters:128*1024,maxMessages:120}));}catch{}
  // Some players consume fetch().body directly, bypassing .text()/.json().
  // Read a bounded clone of metadata responses only; never duplicate media
  // downloads, cancel the player's reader, or retain unbounded feed bodies.
  const observeMetadata=async response=>{
    let reader,timer;
    try{
      const url=http(response?.url),type=responseType(response);
      if(disposed||pendingMetadata>=4||!url||new URL(url).origin!==new URL(target.location.href).origin)return;
      if(!/json|multipart\/mixed/i.test(type)&&!(/\/graphql\/?(?:\?|$)/i.test(url)&&/text\//i.test(type)))return;
      const length=Number(response.headers?.get?.('content-length'));
      if((length>MAX_TEXT&&!/\/graphql\/?(?:\?|$)/i.test(url))||!response.clone||!response.body)return;
      reader=response.clone().body?.getReader?.();if(!reader)return;
      pendingMetadata++;metadataReaders.add(reader);
      let bytes=0,buffer='',whole='',stopped=false;
      const decoder=new TextDecoder();
      timer=setTimeout(()=>{stopped=true;reader.cancel().catch(()=>{});},5000);
      while(!disposed&&!stopped){
        const item=await reader.read();if(item.done)break;
        const available=MAX_TEXT-bytes;
        const chunk=item.value.subarray(0,available);
        bytes+=chunk.byteLength;
        const decoded=decoder.decode(chunk,{stream:true});buffer+=decoded;whole+=decoded;
        // Complete lines can be delivered before a long-lived response ends.
        const newline=buffer.lastIndexOf('\n');
        if(newline>=0){deferMetadata(buffer.slice(0,newline),url,'text');buffer=buffer.slice(newline+1);}
        if(chunk.byteLength<item.value.byteLength||bytes>=MAX_TEXT){stopped=true;break;}
      }
      if(!disposed&&!stopped&&bytes<=MAX_TEXT)deferMetadata(whole+decoder.decode(),url,'text');
    }catch{}finally{
      if(timer)clearTimeout(timer);
      if(reader){metadataReaders.delete(reader);pendingMetadata--;reader.cancel().catch(()=>{});}
    }
  };
  const isOfficialManifestHost = url => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === "dailymotion.com" || host.endsWith(".dailymotion.com") || host === "dmcdn.net" || host.endsWith(".dmcdn.net");
    } catch { return false; }
  };
  const observeManifest=async(response, aliases=[])=>{
    let reader,timer;
    try {
      const url=http(response?.url), type=responseType(response);
      if (!responseSucceeded(response)) return;
      if (disposed || pendingManifest >= 2 || !url || !isManifest(url,type) || !response.clone || !response.body) return;
      const length=Number(response.headers?.get?.("content-length"));
      if (length > MAX_TEXT) return;
      reader=response.clone().body?.getReader?.(); if(!reader)return;
      pendingManifest++;manifestReaders.add(reader);
      let bytes=0,whole="",stopped=false; const decoder=new TextDecoder();
      timer=setTimeout(()=>{stopped=true;reader.cancel().catch(()=>{});},5000);
      while(!disposed&&!stopped){
        const item=await reader.read(); if(item.done)break;
        bytes+=item.value.byteLength; if(bytes>MAX_TEXT){reader.cancel().catch(()=>{});break;}
        whole+=decoder.decode(item.value,{stream:true});
      }
      if(!disposed&&!stopped&&bytes<=MAX_TEXT) {
        const value=whole+decoder.decode();
        parseText(value,url,type);
        rememberManifest(url,value,type,aliases);
      }
    }catch{}finally{
      if(timer)clearTimeout(timer); if(reader){manifestReaders.delete(reader);pendingManifest--;reader.cancel().catch(()=>{});}
    }
  };
  if(typeof target.fetch==='function'){
    const original=target.fetch;
    const wrapped=function(...args){
      const result=original.apply(this,args);
      return result.then(response=>{
        try{const url=http(response?.url),alias=http(typeof args[0]==='string'?args[0]:args[0]?.url,target.location?.href);if(url&&responseSucceeded(response))rememberBody(response.body,url,responseType(response));void observeManifest(response,alias?[alias]:[]);}catch{}
        void observeMetadata(response);return response;
      });
    };
    target.fetch=wrapped;
    wrappers.push(()=>{if(target.fetch===wrapped)target.fetch=original;});
  }
  // Track ownership of existing fetch stream chunks without cloning, retaining
  // or re-reading the media. This covers players that bypass arrayBuffer().
  const streamProto=target.ReadableStream?.prototype;
  if(typeof streamProto?.getReader==='function'){
    const original=streamProto.getReader;
    const wrapped=function(...args){const reader=original.apply(this,args),url=bodyUrl.get(this);if(url)readerUrls.set(reader,url);return reader;};
    streamProto.getReader=wrapped;
    wrappers.push(()=>{if(streamProto.getReader===wrapped)streamProto.getReader=original;});
  }
  for(const proto of [target.ReadableStreamDefaultReader?.prototype,target.ReadableStreamBYOBReader?.prototype]){
    if(typeof proto?.read!=='function')continue;
    const original=proto.read;
    const wrapped=function(...args){
      const result=original.apply(this,args),url=readerUrls.get(this);
      if(!url)return result;
      return result.then(item=>{if(item?.value){rememberBody(item.value,url);if(item.value.buffer)bufferUrl.set(item.value.buffer,url);}return item;});
    };
    proto.read=wrapped;
    wrappers.push(()=>{if(proto.read===wrapped)proto.read=original;});
  }
  const wrapResponse = (name) => {
    const proto = target.Response?.prototype,
      original = proto?.[name];
    if (typeof original !== "function") return;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      let url, type;
      try {
        url = http(this?.url);
        type = responseType(this);
      } catch {
        return result;
      }
      if (!url) return result;
      let then;
      try {
        then = result?.then;
      } catch {
        return result;
      }
      if (typeof then !== "function") return result;
      return then.call(result, (value) => {
        try {
          if (!responseSucceeded(this)) return value;
          rememberBody(value, url, type);
          if (name === "text") {
            parseText(value, url, type);
            if (
              /json/i.test(type) ||
              /^\s*(?:for\s*\(;;\);\s*)?[\[{]/.test(value)
            ) {
              deferMetadata(value,url,'text');
            }
          }
          if (name === "json") deferMetadata(value, url, 'json');
        } catch {}
        return value;
      });
    };
    proto[name] = wrapped;
    wrappers.push(() => {
      if (proto[name] === wrapped) proto[name] = original;
    });
  };
  wrapResponse("arrayBuffer");
  wrapResponse("blob");
  wrapResponse("text");
  wrapResponse("json");
  const xhrProto = target.XMLHttpRequest?.prototype;
  if (xhrProto?.open && xhrProto?.send) {
    const open = xhrProto.open,
      send = xhrProto.send;
    const wrappedOpen = function (method, url, ...args) {
      const result = open.call(this, method, url, ...args);
      try {
        xhrUrls.set(this, http(url, target.location?.href));
      } catch {}
      return result;
    };
    const wrappedSend = function (...args) {
      const xhr = this;
      try {
        xhr.addEventListener?.(
          "load",
          () => {
            try {
              const url = http(xhr.responseURL || xhrUrls.get(xhr));
              if (!url || (typeof xhr.status === "number" && xhr.status >= 400)) return;
              const type = xhr.getResponseHeader?.("content-type") || "";
              const value = xhr.response;
              if (value && typeof value === "object")
                rememberBody(value, url, type);
              if (
                xhr.responseType === "text" ||
                (!xhr.responseType && typeof xhr.responseText === "string")
              ) {
                parseText(xhr.responseText, url, type);
                if (
                  /json/i.test(type) ||
                  /^\s*(?:for\s*\(;;\);\s*)?[\[{]/.test(xhr.responseText)
                ) {
                  deferMetadata(xhr.responseText,url,'text');
                }
              }
              touch(url, type, isManifest(url, type));
            } catch {}
          },
          { once: true },
        );
      } catch {}
      return send.apply(this, args);
    };
    xhrProto.open = wrappedOpen;
    xhrProto.send = wrappedSend;
    wrappers.push(() => {
      if (xhrProto.open === wrappedOpen) xhrProto.open = open;
      if (xhrProto.send === wrappedSend) xhrProto.send = send;
    });
  }
  const urlApi = target.URL;
  if (urlApi?.createObjectURL) {
    const create = urlApi.createObjectURL;
    const wrappedCreate = function (value) {
      const result = create.call(this, value);
      try {
        const source = sourceOf(value);
        objectUrls.set(result, {
          ref: typeof WeakRef === "function" ? new WeakRef(value) : null,
          source,
          revoked: false,
          at: now(),
        });
        while (objectUrls.size > MAX_OBJECT_URLS)
          objectUrls.delete(objectUrls.keys().next().value);
        if (source) touch(source);
      } catch {}
      return result;
    };
    urlApi.createObjectURL = wrappedCreate;
    wrappers.push(() => {
      if (urlApi.createObjectURL === wrappedCreate)
        urlApi.createObjectURL = create;
    });
    if (urlApi.revokeObjectURL) {
      const revoke = urlApi.revokeObjectURL;
      const wrappedRevoke = function (url) {
        try {
          const record = objectUrls.get(url);
          if (record) {
            record.revoked = true;
            record.at = now();
          }
        } catch {}
        return revoke.call(this, url);
      };
      urlApi.revokeObjectURL = wrappedRevoke;
      wrappers.push(() => {
        if (urlApi.revokeObjectURL === wrappedRevoke)
          urlApi.revokeObjectURL = revoke;
      });
    }
  }
  const msProto = target.MediaSource?.prototype;
  if (msProto?.addSourceBuffer) {
    const add = msProto.addSourceBuffer;
    const wrappedAdd = function (...args) {
      const buffer = add.apply(this, args);
      try {
        const record = mediaSources.get(this) || {
          buffers: new Set(),
          at: now(),
        };
        record.buffers.add(buffer);
        record.at = now();
        mediaSources.set(this, record);
        sourceBuffers.set(buffer, this);
      } catch {}
      return buffer;
    };
    msProto.addSourceBuffer = wrappedAdd;
    wrappers.push(() => {
      if (msProto.addSourceBuffer === wrappedAdd) msProto.addSourceBuffer = add;
    });
  }
  if (msProto?.removeSourceBuffer) {
    const remove = msProto.removeSourceBuffer;
    const wrappedRemove = function (buffer) {
      const result = remove.apply(this, arguments);
      try {
        mediaSources.get(this)?.buffers.delete(buffer);
      } catch {}
      return result;
    };
    msProto.removeSourceBuffer = wrappedRemove;
    wrappers.push(() => {
      if (msProto.removeSourceBuffer === wrappedRemove)
        msProto.removeSourceBuffer = remove;
    });
  }
  const sbProto = target.SourceBuffer?.prototype;
  if (sbProto?.appendBuffer) {
    const append = sbProto.appendBuffer;
    const wrappedAppend = function (value) {
      const result = append.apply(this, arguments);
      try {
        const source = sourceOf(value),
          ms = sourceBuffers.get(this),
          record = mediaSources.get(ms);
        if (record) {
          record.at = now();
          record.latest ||= new WeakMap();
          if (source) {
            record.latest.set(this, {source,roots:rootsFor(source).map(url=>({url,kind:known.get(url)?.kind || 'hls'}))});
            touch(source, "", true);
          }
        }
      } catch {}
      return result;
    };
    sbProto.appendBuffer = wrappedAppend;
    wrappers.push(() => {
      if (sbProto.appendBuffer === wrappedAppend) sbProto.appendBuffer = append;
    });
  }
  const rootsFor = (url, seen = new Set()) => {
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const parents = [...(graph.get(url) || [])];
    if (!parents.length) {
      const patternParents = patterns
        .filter((pattern) => {
          try {
            return pattern.regex.test(url);
          } catch {
            return false;
          }
        })
        .map((pattern) => pattern.parent);
      if (patternParents.length)
        return patternParents.flatMap((parent) => rootsFor(parent, seen));
      return known.get(url)?.manifest ? [url] : [];
    }
    return parents.flatMap((parent) => rootsFor(parent, seen));
  };
  const sourcesFor = (video) => {
    const candidates = [];
    const raw = video?.currentSrc || mediaElementSource(video);
    const direct =
      http(raw, target.location?.href) ||
      (/^blob:/i.test(String(raw || "")) ? String(raw) : "");
    const present=objectUrls.get(direct);if(present)present.at=now();prune();
    let associatedRoot = false;
    const add = (url, kind, evidence, sourceGroup) => {
      if (!url) return;
      const existing=candidates.find(c=>c.url===url);
      if(existing){existing.evidence=[...new Set([...existing.evidence,...evidence])];if(sourceGroup)existing.sourceGroup=sourceGroup;return;}
      candidates.push({ url, kind, evidence, downloadable: true, ...(sourceGroup?{sourceGroup}:{}) });
    };
    if (direct) {
      const object = objectUrls.get(direct);
      if (object) object.at = now();
      const value = object?.ref?.deref?.();
      const ms = value && mediaSources.get(value);
      const active = ms
        ? [
            ...(ms.latest
              ? [...ms.buffers].map((b) => ms.latest.get(b)).filter(Boolean)
              : []),
          ]
        : [];
      const urls = object?.source
        ? [object.source]
        : active.length
          ? active.map(item=>item.source)
          : [direct];
      const cachedRoots=active.flatMap(item=>item.roots || []);
      const roots = [...new Set([...urls.flatMap((url) => rootsFor(url)),...cachedRoots.map(item=>item.url)])];
      if (roots.length > 1)
        return { candidates: [], pending: true, reason: "ambiguous-mse-roots" };
      if (roots.length === 1) {
        add(roots[0], known.get(roots[0])?.kind || cachedRoots.find(item=>item.url===roots[0])?.kind || "hls", ["mse-master-root"]);
        associatedRoot = true;
      }
      // A single range-fetched MP4 can feed MSE directly without an HLS/DASH
      // manifest. It is safe only when all active buffers agree on one URL.
      const progressive=[...new Set(active.map(item=>item.source))];
      if(!roots.length&&progressive.length===1&&known.get(progressive[0])?.kind==='progressive'&&!isSegment(progressive[0])){
        add(progressive[0],'progressive',['mse-progressive-body']);
        associatedRoot=true;
      }
      if (
        !ms &&
        object?.source &&
        known.get(object.source)?.kind === "progressive"
      )
        add(object.source, "progressive", ["blob-http-body"]);
    }
    try {
      const model = modelStore.modelFor(video, target.location?.href);
      if (model) {
        if (model.manifestUrl)
          add(
            model.manifestUrl,
            model.manifestType || (/mpd/i.test(model.manifestUrl) ? "dash" : "hls"),
            ["embedded-model.manifestUrl"],
          );
        for (const version of model.versions || [])
          add(version.url, "progressive", ["embedded-model.version"]);
      }
      const evidence = collectMediaEvidence({
        video,
        root:target.document,
        pageUrl: target.location?.href,
      });
      if (!associatedRoot)
        for (const item of evidence.candidates)
          if (item.downloadable && !isSegment(item.url))
            add(item.url, item.kind, item.evidence, item.sourceGroup);
    } catch {}
    if (candidates.length) {
      for (const c of candidates)
        if (known.has(c.url)) {
          known.get(c.url).active = true;
          known.get(c.url).at = now();
        }
      return { candidates, pending: false, reason: "" };
    }
    return {
      candidates,
      pending: !!direct,
      reason:
        !target.document && target.MediaSource
          ? "worker-mse-not-trackable"
          : direct && objectUrls.has(direct)
            ? "buffer-source-not-observed"
            : "no-associated-source",
    };
  };
  const dispose = () => {
    disposed=true;
    for(const reader of metadataReaders)reader.cancel().catch(()=>{});
    for(const reader of manifestReaders)reader.cancel().catch(()=>{});
    for (const restore of wrappers.splice(0))
      try {
        restore();
      } catch {}
    objectUrls.clear();
    try{videoRegistryObserver?.disconnect?.();}catch{} try{shadowRestore?.();}catch{} videoRegistry.clear();shadowRoots.clear();walkQueue.length=0;deferredMetadata.length=0;deferredBytes=0;
    graph.clear();
    known.clear();
    manifests.clear(); manifestAliases.clear(); manifestBytes=0;
    if (target[OBSERVER_SYMBOL]?.dispose === dispose)
      try {
        delete target[OBSERVER_SYMBOL];
      } catch {
        target[OBSERVER_SYMBOL] = undefined;
      }
  };
  const api = {
    build: BUILD_ID,
    sourcesFor,
    titleFor: (video,options) => titleFor(video,options),
    isGenericTitle: isGenericMediaTitle,
    twitchPlayerFor: (video,videos) => {
      if(!/(^|\.)twitch\.tv$/i.test(target.location?.hostname || ''))return null;
      const metadata=extractTwitchPlayerMetadata(video,{url:target.location.href,uniquePlayer:videos?.length===1});
      if(!metadata)return null;
      const {owner,...data}=metadata;return data;
    },
    manifestFor,
    modelFor: (video,options={}) => (options.drain===false?null:drainMetadata(16,options.budget,video), modelStore.modelFor(video, target.location?.href)),
    canonicalVideo: (video) => modelStore.canonicalVideo(video),
    metadataCandidatesFor: (video,videos) => modelStore.metadataCandidatesFor(video,target.location?.href,videos),
    validateMetadataPlan: (token,video,videos) => modelStore.validateMetadataPlan(token,video,target.location?.href,videos),
    diagnosticsFor: (video) => (prune(),{observerBuild:BUILD_ID,json:jsonMetadata.stats(),metadataQueue:deferredMetadata.length,metadataQueueBytes:deferredBytes,metadataGeneration:lastDrainGeneration,manifests:manifests.size,...modelStore.diagnosticsFor(video,target.location?.href)}),
    videosSnapshot: (limit=256) => [...videoRegistry].filter(video=>video?.isConnected!==false).slice(0,Math.max(1,Math.min(256,Number(limit)||256))),
    drainMetadata,
    pageContext: () => dailymotionContext(target.document,target.location?.href),
    scanDocument: (videos,budget,selectedVideo) =>
      (budget?null:drainMetadata(16,undefined,selectedVideo), modelStore.scanDocument(target.document, target.location?.href,videos,budget,selectedVideo)),
    dispose,
  };
  try {
    target.addEventListener?.(
      "pagehide",
      (event) => {
        if (!event?.persisted) dispose();
      },
      { once: true },
    );
  } catch {}
  target[OBSERVER_SYMBOL] = api;
  exposeSourceEvidence(target);
  return api;
}

export { OBSERVER_SYMBOL };
