// X/Twitter legacy media extraction. Kept separate from the generic model
// walker because tweet/quoted-tweet ownership is structural, not alias based.
const MAX_MODELS = 128;
const MAX_VARIANTS = 32;
const MAX_DEPTH = 32;
const MEDIA_KEYS = ['id_str', 'media_key', 'media_id', 'mediaID', 'id','rest_id','videoID','videoId','video_id'];
const POST_KEYS = ['rest_id', 'tweet_id', 'id_str', 'id'];
const text = v => typeof v === 'string' && v.trim() ? v.trim() : '';
const id = v => (typeof v === 'string' || typeof v === 'number') && String(v).trim() ? String(v).trim() : '';
const num = v => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
function http(value, base) {
  const raw = text(value); if (!raw || raw.length > 16384) return '';
  try { const u = new URL(raw, base || undefined); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
}
function dimensions(value) {
  const m = text(value).match(/(?:^|[^0-9])([1-9][0-9]{1,5})x([1-9][0-9]{1,5})(?:[^0-9]|$)/i);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
}
function mediaId(media) { for (const key of MEDIA_KEYS) { const value = id(media?.[key]); if (value) return value; } return ''; }
function postId(tweet) {
  for (const key of POST_KEYS) { const value = id(tweet?.[key]); if (value) return value; }
  return id(tweet?.legacy?.id_str);
}
function variant(value, base) {
  if (!value || typeof value !== 'object') return null;
  const source = http(value.url || value.src || value.uri, base); if (!source) return null;
  const type = text(value.content_type || value.type || value.mime_type).toLowerCase();
  const d = dimensions(source);
  return { url: source, ...(type ? { contentType: type } : {}), ...(num(value.bitrate) ? { bitrate: num(value.bitrate) } : {}), width: num(value.width) || d.width, height: num(value.height) || d.height };
}
function liveStatusKey(raw, base = '') {
  let u; try { u = new URL(raw || base, base || undefined); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol) || !/^(?:(?:www|api)\.)?(?:x\.com|twitter\.com)$/i.test(u.hostname)) return '';
  const m = u.pathname.match(/^\/(?:i\/api\/)?(?:1\.1\/)?live_video_stream\/status\/([^/?#]+)\/?$/i);try{return m?decodeURIComponent(m[1]):'';}catch{return '';}
}
export function xBroadcastIdFromUrl(raw) {
  try {
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password||!/^(?:www\.)?(?:x|twitter)\.com$/i.test(u.hostname))return '';
    return u.pathname.match(/^\/i\/broadcasts\/([A-Za-z0-9_-]{3,128})\/?$/)?.[1] || '';
  } catch { return ''; }
}
function broadcastIdOf(value) { return id(value?.broadcast_id || value?.broadcastId || value?.id); }
function broadcastMediaKey(value) { return id(value?.media_key || value?.mediaKey); }
function broadcastDescriptor(value, aliases, source, bindingOnly = true) {
  const key=broadcastMediaKey(value),numeric=key.match(/^\d+_(\d+)$/)?.[1];
  const ids = [...new Set([...aliases,id(value?.media_id),numeric].map(id).filter(Boolean))]; if (!ids.length) return null;
  const out = { id: ids[0], aliases: ids, provider: 'x', versions: [], bindingOnly };
  const bid=broadcastIdOf(value);
  if(/^[A-Za-z0-9_-]{3,128}$/.test(bid)){
    out.broadcastId=bid;out.broadcastUrl='https://x.com/i/broadcasts/'+bid;
    const title=text(value?.status || value?.title);if(title)out.title=title.slice(0,512);
    if(num(value?.width))out.width=num(value.width);if(num(value?.height))out.height=num(value.height);
  }
  if (source) { out.manifestUrl = source; out.manifestType = 'hls'; out.bindingOnly = false; }
  return out;
}
function broadcastEntries(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  const group = value.broadcasts;
  if (Array.isArray(group)) for (const item of group.slice(0,MAX_MODELS)) out.push(item);
  else if (group && typeof group === 'object') for (const key of Object.keys(group).slice(0,MAX_MODELS)){const item=group[key];if(item&&typeof item==='object')out.push({id:key,...item});}
  const broadcast=value.broadcast_by_rest_id;
  if(broadcast&&typeof broadcast==='object'&&broadcastIdOf(broadcast)&&broadcastMediaKey(broadcast))out.push(broadcast);
  return out;
}

function tweetBroadcast(tweet,legacy,owner,ownerTitle){
  const card=tweet.card?.legacy || tweet.card || legacy.card?.legacy || legacy.card,bindings=card?.binding_values,values={};
  const fields=Array.isArray(bindings)?bindings.slice(0,64):Object.entries(bindings || {}).slice(0,64).map(([key,value])=>({key,value}));
  for(const field of fields)if(/^broadcast_(?:id|url|media_key|media_id|title|width|height)$/.test(field?.key || ''))values[field.key]=text(field.value?.string_value);
  const fromUrl=xBroadcastIdFromUrl(values.broadcast_url),explicit=values.broadcast_id;
  if(explicit&&fromUrl&&explicit!==fromUrl)return null;
  const bids=new Set([explicit,fromUrl].filter(Boolean));
  for(const item of (Array.isArray(legacy.entities?.urls)?legacy.entities.urls:[]).slice(0,32)){
    const bid=xBroadcastIdFromUrl(item?.expanded_url || item?.unwound_url);if(bid)bids.add(bid);
  }
  if(bids.size!==1)return null;
  const bid=[...bids][0],key=values.broadcast_media_key;if(!/^[A-Za-z0-9_-]{3,128}$/.test(bid))return null;
  return broadcastDescriptor({broadcast_id:bid,media_key:key,media_id:values.broadcast_media_id,status:values.broadcast_title || ownerTitle,width:values.broadcast_width,height:values.broadcast_height},[bid,key,owner]);
}

// X streams query results as JSON strings inside executable React bootstrap
// scripts. Decode only complete JSON string values; never evaluate the script.
export function xMediaPayloadsFromScript(source,parseJson=JSON.parse){
  if(typeof source!=='string'||source.length>1024*1024||!/(?:broadcast_by_rest_id|broadcast_id|broadcast_url)/.test(source))return [];
  const result=[];
  for(const match of source.matchAll(/\bvalue\s*:\s*("(?:\\.|[^"\\])*")/g)){
    if(result.length>=16)break;
    if(!/(?:broadcast_by_rest_id|broadcast_id|broadcast_url)/.test(match[1])||match[1].length>1024*1024)continue;
    try{
      const decoded=parseJson(match[1]);
      if(typeof decoded==='string'&&decoded.length<=512*1024){const value=parseJson(decoded);if(value&&typeof value==='object')result.push(value);}
    }catch{}
  }
  return result;
}
function broadcastSource(value, baseUrl, mediaKey) {
  const statusKey = liveStatusKey(baseUrl); if (!statusKey || statusKey !== mediaKey) return '';
  const source = value?.source; if (!source || typeof source !== 'object') return '';
  for (const key of ['noRedirectPlaybackUrl', 'location']) {
    const url = http(source[key], baseUrl); if (url && /\.m3u8(?:[?#]|$)/i.test(url) && /^https?:$/i.test(new URL(url).protocol)) return url;
  }
  return '';
}
function makeDescriptor(media, ownerPostId, base, allowPostAlias, ownerTitle = '') {
  const info = media?.video_info;
  if (!info || typeof info !== 'object') return null;
  const versions = [], seen = new Set();
  for (const item of Array.isArray(info.variants) ? info.variants : []) {
    if (versions.length >= MAX_VARIANTS) break;
    const v = variant(item, base); if (!v || seen.has(v.url)) continue;
    seen.add(v.url); versions.push(v);
  }
  if (!versions.length) return null;
  const mediaKey = mediaId(media), aliases = [...new Set([mediaKey, id(media?.media_key), ...(allowPostAlias && ownerPostId ? [ownerPostId] : [])].filter(Boolean))];
  const hls = versions.find(v => /mpegurl|m3u8|hls/i.test(v.contentType || '') || /\.m3u8(?:[?#]|$)/i.test(v.url));
  const progressive = versions.filter(v => !(/mpegurl|m3u8|hls/i.test(v.contentType || '') || /\.m3u8(?:[?#]|$)/i.test(v.url)));
  const original = media.original_info || media.originalInfo || info.original_info || info.originalInfo || {};
  const width = num(original.width) || Math.max(...versions.map(v => v.width || 0), 0) || undefined;
  const height = num(original.height) || Math.max(...versions.map(v => v.height || 0), 0) || undefined;
  const duration = num(info.duration_millis) ? Number(info.duration_millis) / 1000 : num(info.duration_ms) ? Number(info.duration_ms) / 1000 : num(info.duration);
  const title = text(ownerTitle || media?.title || media?.alt_text);
  return { id: aliases[0] || undefined, aliases, provider: 'x', ownerPostId: ownerPostId || undefined, versions: progressive, ...(hls ? { manifestUrl: hls.url, manifestType: 'hls' } : {}), ...(duration ? { duration } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}), ...(title ? { title: title.slice(0, 512) } : {}) };
}

export function extractXMediaModels(value, { baseUrl = '', budget = 1024 * 1024 } = {}) {
  const models = [], seenNodes = new WeakSet(), seenMedia = new Set(); let used = 0;
  const broadcasts = new Map();
  for (const item of broadcastEntries(value)) {
    const bid = broadcastIdOf(item), key = broadcastMediaKey(item);
    if (!bid && !key) continue;
    const descriptor = broadcastDescriptor(item, [bid, key]); if (!descriptor) continue;
    broadcasts.set(key || bid, descriptor); models.push(descriptor);
  }
  const processTweet = tweet => {
    if (!tweet || typeof tweet !== 'object') return;
    const legacy = tweet.legacy && typeof tweet.legacy === 'object' ? tweet.legacy : tweet;
    const owner = postId(tweet) || postId(legacy);
    const ownerTitle = text(tweet.full_text || legacy.full_text || tweet.text || legacy.text);
    const groups = [legacy.extended_entities?.media, legacy.entities?.media, tweet.extended_entities?.media, tweet.entities?.media].filter(Array.isArray);
    const media = [];
    for (const group of groups) for (const item of group) {
      if (!item || typeof item !== 'object' || !item.video_info) continue;
      const key = mediaId(item) || JSON.stringify(item.video_info.variants || []);
      if (!media.some(x => x.key === key)) media.push({ item, key });
    }
    if (legacy.video_info) media.push({ item: legacy, key: mediaId(legacy) || `direct:${owner || ''}` });
    if(!media.length){const broadcast=tweetBroadcast(tweet,legacy,owner,ownerTitle);if(broadcast)models.push(broadcast);}
    const allowPostAlias = media.length === 1;
    for (const { item, key } of media) {
      const descriptor = makeDescriptor(item, owner, baseUrl, allowPostAlias, ownerTitle); if (!descriptor) continue;
      const dedupe = `${descriptor.ownerPostId || ''}:${key}`; if (seenMedia.has(dedupe)) continue;
      seenMedia.add(dedupe); models.push(descriptor); if (models.length >= MAX_MODELS) return;
    }
  };
  const walk = (node, depth = 0, inMedia = false) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH || models.length >= MAX_MODELS || used > budget || seenNodes.has(node)) return;
    seenNodes.add(node); used += Object.keys(node).length * 24;
    const isTweet = !!(node.legacy || node.tweet_id || node.quoted_status_result || ((node.id_str||node.rest_id) && (node.extended_entities || node.entities || node.card)));
    if (isTweet) processTweet(node);
    const statusKey = liveStatusKey(baseUrl);
    if (statusKey && node.source && typeof node.source === 'object') {
      const source = broadcastSource(node, baseUrl, statusKey);
      if (source) {
        const known = broadcasts.get(statusKey);
        if (!broadcasts.size || known) {
          const descriptor = broadcastDescriptor(node, [statusKey, ...(known?.aliases || [])], source, false);
          if (descriptor) models.push(descriptor);
        }
      }
    }
    for (const item of broadcastEntries(node)) {
      const bid = broadcastIdOf(item), key = broadcastMediaKey(item);
      if (!bid && !key) continue;
      const descriptor = broadcastDescriptor(item, [bid, key]);
      if (descriptor && !broadcasts.has(key || bid)) { broadcasts.set(key || bid, descriptor); models.push(descriptor); }
    }
    if (!inMedia && node.video_info && !(isTweet && node.legacy)) {
      const direct = makeDescriptor(node, '', baseUrl, false); if (direct) {
        const key = mediaId(node) || `direct:${direct.versions[0]?.url || direct.manifestUrl || ''}`;
        if (!seenMedia.has(`:${key}`)) { seenMedia.add(`:${key}`); models.push(direct); }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (!child || typeof child !== 'object') continue;
      if (key === 'media' && (node.extended_entities || node.entities)) continue;
      walk(child, depth + 1, inMedia || (key === 'media' && Array.isArray(child) && child.some(item => item && typeof item === 'object' && item.video_info)));
    }
  };
  walk(value); return models.slice(0, MAX_MODELS);
}

// Read only props/fibers owned by the rendered element. No getters are called.
export function ownedXPlayerMetadata(video, { maxDepth = 9 } = {}) {
  const idKeys = new Set(['videoID', 'videoId', 'video_id', 'mediaID', 'media_id', 'media_key', 'mediaKey', 'broadcastId', 'broadcast_id']);
  const seen = new WeakSet(); let remaining = 1600;
  const data=(object,key)=>{try{return Object.getOwnPropertyDescriptor(object,key)?.value;}catch{return undefined;}};
  const copyMedia=node=>{
    const result={};
    for(const key of [...MEDIA_KEYS,'videoID','videoId','type','title','alt_text']){const value=data(node,key);if(typeof value==='string'||typeof value==='number')result[key]=value;}
    const info=data(node,'video_info');result.video_info={};
    for(const key of ['duration_millis','duration_ms','duration']){const value=data(info,key);if(typeof value==='number')result.video_info[key]=value;}
    const variants=data(info,'variants');result.video_info.variants=[];
    for(let i=0;Array.isArray(variants)&&i<Math.min(variants.length,32);i++){
      const source=data(variants,String(i)),variant={};
      for(const key of ['url','src','content_type','type','mime_type','bitrate','width','height']){const value=data(source,key);if(typeof value==='string'||typeof value==='number')variant[key]=value;}
      result.video_info.variants.push(variant);
    }
    const original=data(node,'original_info')||data(info,'original_info');
    if(original)result.original_info={width:data(original,'width'),height:data(original,'height')};
    return result;
  };
  const inspect = root => {
    const ids = new Set(), payloads = [];
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > maxDepth || remaining-- <= 0 || seen.has(node)) return;
      seen.add(node); let fields; try { fields = Object.getOwnPropertyDescriptors(node); } catch { return; }
      for (const key of idKeys) { const v = fields[key]?.value; const value = id(v); if (value) ids.add(value); }
      if (fields.video_info?.value && typeof fields.video_info.value === 'object') {
        payloads.push(copyMedia(node));
        for(const key of MEDIA_KEYS){const value=id(fields[key]?.value);if(value)ids.add(value);}
      }
      for (const [key, field] of Object.entries(fields).slice(0, 160)) {
        if (['return', 'child', 'children', 'sibling', 'stateNode', '_owner', 'ref', 'current', 'ownerDocument', 'parentNode','quoted_status_result','retweeted_status_result'].includes(key)) continue;
        if (field.value && typeof field.value === 'object' && !field.value.nodeType) walk(field.value, depth + 1);
      }
    };
    walk(root, 0); return { ids: [...ids], payloads };
  };
  let node = video,nearestIds=[];
  const accept=root=>{
    const found=inspect(root);
    if(!nearestIds.length&&found.ids.length)nearestIds=found.ids;
    if(!found.payloads.length)return null;
    const matching=found.payloads.filter(payload=>{
      const aliases=extractXMediaModels(payload).flatMap(model=>model.aliases);
      return !nearestIds.length||nearestIds.every(value=>aliases.includes(value));
    });
    return matching.length?{ids:nearestIds,payloads:matching}:null;
  };
  const boundary=host=>{
    if(!host||host===video||host.nodeType!==1)return false;
    try{return /^(?:BODY|HTML|ARTICLE)$/i.test(host.tagName||'')||host.getAttribute?.('role')==='article'||host.querySelectorAll?.('video').length>1;}catch{return true;}
  };
  for (let level = 0; node && level < 16 && remaining > 0; level++, node = node.parentElement) {
    try { if (level && node.querySelectorAll?.('video').length > 1) break; } catch { break; }
    try { if (level && (/^ARTICLE$/i.test(node.tagName || '') || String(node.getAttribute?.('role') || '').toLowerCase() === 'article')) break; } catch { break; }
    let descriptors; try { descriptors = Object.getOwnPropertyDescriptors(node); } catch { continue; }
    for (const [key, entry] of Object.entries(descriptors)) {
      if (key.startsWith('__reactProps$')) {
        const found=accept(entry.value);if(found)return found;
      }
      if (!key.startsWith('__reactFiber$')) continue;
      let fiber = entry.value;
      for (let depth = 0; fiber && depth < 24 && remaining > 0; depth++, fiber = data(fiber,'return')) {
        if(boundary(data(fiber,'stateNode')))break;
        const found=accept(data(fiber,'memoizedProps'));if(found)return found;
      }
    }
  }
  return { ids: nearestIds, payloads: [] };
}
