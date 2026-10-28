const MAX_ID_LENGTH = 32;
const MAX_PLAYER_ENTRIES = 32;
const MAX_SCRIPTS = 8;
const MAX_SCRIPT_CHARS = 512 * 1024;
const MAX_CONFIG_DEPTH = 12;
const MAX_CDNS = 16;
const MAX_PROGRESSIVE = 32;
const functionToString = Function.prototype.toString;

const objectLike = value => value !== null && typeof value === 'object';
const ownDescriptor = (object, key) => {
  try { return Object.getOwnPropertyDescriptor(object, key); } catch { return undefined; }
};
const ownData = (object, key) => {
  const descriptor = ownDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const plainObject = value => {
  if (!objectLike(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
};
const text = (value, limit = 16384) => typeof value === 'string' && value.length <= limit ? value.trim() : '';
const shortTitle = value => typeof value === 'string' ? value.slice(0, 512).trim() : '';
const safeId = value => {
  if (!(typeof value === 'string' || typeof value === 'number')) return '';
  const id = String(value).trim();
  return id.length <= MAX_ID_LENGTH && /^\d+$/.test(id) ? id : '';
};

function routeVideoId(pageUrl) {
  let url;
  try { url = new URL(pageUrl); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password) return '';
  const host = url.hostname.toLowerCase();
  let match;
  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    match = url.pathname.match(/^\/(\d{1,32})(?:\/|$)/);
  } else if (host === 'player.vimeo.com') {
    match = url.pathname.match(/^\/video\/(\d{1,32})(?:\/|$)/);
  }
  return match?.[1] || '';
}

function safeHttpsUrl(raw) {
  const value = text(raw);
  if (!value || value.length > 16384) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function safeConfigUrl(raw, id) {
  const value = text(raw);
  if (!value || value.length > 16384 || !id) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'player.vimeo.com' ||
        url.username || url.password || url.hash || url.pathname !== `/video/${id}/config`) return '';
    return url.href;
  } catch { return ''; }
}

// Read standard DOM accessors only from the corresponding native prototype.
// Page-defined own getters are never invoked.
function safeProperty(object, key, target, nativeInterfaces = []) {
  if (!objectLike(object)) return undefined;
  const own = ownDescriptor(object, key);
  if (own) {
    if (Object.hasOwn(own, 'value')) return own.value;
    // Chromium exposes Window.document as an own, non-configurable native
    // accessor rather than on Window.prototype. Permit only that accessor so
    // late popup reads can inspect inline scripts without opening page getters.
    if (object === target && key === 'document' && nativeInterfaces.includes('Window') && own.configurable === false && typeof own.get === 'function') {
      const constructor = ownData(target, 'Window');
      const prototype = ownData(constructor, 'prototype');
      let source = '';
      try { source = Reflect.apply(functionToString, own.get, []); } catch {}
      if (typeof constructor === 'function' && objectLike(prototype) && /\bget document\b/.test(source) && /\[native code\]/.test(source)) {
        try { return Reflect.apply(own.get, object, []); } catch { return undefined; }
      }
    }
    return undefined;
  }
  let prototype;
  try { prototype = Object.getPrototypeOf(object); } catch { return undefined; }
  while (prototype) {
    const descriptor = ownDescriptor(prototype, key);
    if (descriptor) {
      if (Object.hasOwn(descriptor, 'value')) return descriptor.value;
      if (typeof descriptor.get !== 'function') return undefined;
      for (const name of nativeInterfaces) {
        const constructor = ownData(target, name);
        const nativePrototype = ownData(constructor, 'prototype');
        if (prototype === nativePrototype) {
          try { return Reflect.apply(descriptor.get, object, []); } catch { return undefined; }
        }
      }
      return undefined;
    }
    try { prototype = Object.getPrototypeOf(prototype); } catch { return undefined; }
  }
  return undefined;
}

function nativeMethod(target, interfaceName, key) {
  const constructor = ownData(target, interfaceName);
  const prototype = ownData(constructor, 'prototype');
  const descriptor = ownDescriptor(prototype, key);
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function'
    ? descriptor.value : undefined;
}

function mediaKeysPresent(video, target) {
  const own = ownDescriptor(video, 'mediaKeys');
  if (own) {
    if (!Object.hasOwn(own, 'value')) return true;
    return own.value != null;
  }
  const constructor = ownData(target, 'HTMLMediaElement');
  const nativePrototype = ownData(constructor, 'prototype');
  let prototype;
  try { prototype = Object.getPrototypeOf(video); } catch { return true; }
  while (prototype) {
    const descriptor = ownDescriptor(prototype, 'mediaKeys');
    if (descriptor) {
      if (!nativePrototype) return true;
      if (prototype !== nativePrototype || typeof descriptor.get !== 'function') return true;
      try { return Reflect.apply(descriptor.get, video, []) != null; } catch { return true; }
    }
    try { prototype = Object.getPrototypeOf(prototype); } catch { return true; }
  }
  return false;
}

function elementContains(wrapper, video, target) {
  if (wrapper === video) return true;
  if (!objectLike(wrapper)) return false;
  const method = nativeMethod(target, 'Node', 'contains');
  if (typeof method !== 'function') return false;
  try { return Reflect.apply(method, wrapper, [video]) === true; } catch { return false; }
}

function playerOwner(player, video, target) {
  if (player !== video && elementContains(player, video, target)) return player;
  for (const key of ['element', 'el_', 'iframe', 'video', 'videoElement', 'wrapper']) {
    const element = ownData(player, key);
    if (element === video || elementContains(element, video, target)) return element;
  }
  return null;
}

function selectedPlayer(video, players, target) {
  if (!Array.isArray(players)) return null;
  const length = Math.min(ownData(players, 'length') || 0, MAX_PLAYER_ENTRIES);
  const matches = [];
  for (let index = 0; index < length; index++) {
    const player = ownData(players, String(index));
    if (!player) continue;
    const wrapper = playerOwner(player, video, target);
    if (wrapper) matches.push({player, wrapper});
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

function activeProtection(value) {
  if (value == null || value === false || value === 0 || value === '') return false;
  if (typeof value === 'string' && /^(?:false|none|off|0)$/i.test(value.trim())) return false;
  return true;
}

function protectionFlag(value) {
  if (!plainObject(value)) return false;
  for (const key of ['drm', 'isDrm', 'hasDrm', 'widevine', 'fairplay', 'playready', 'licenseUrl', 'license_url', 'keySystems', 'key_systems', 'protection']) {
    const field = ownDescriptor(value, key);
    if (field && Object.hasOwn(field, 'value') && activeProtection(field.value)) return true;
  }
  return false;
}

function containsDrm(config) {
  if (protectionFlag(config)) return true;
  const video = ownData(config, 'video'), request = ownData(config, 'request'), files = ownData(request, 'files');
  return [video, request, files, ownData(files, 'hls'), ownData(files, 'dash')].some(protectionFlag);
}

function normalizedFileGroup(group) {
  if (!plainObject(group)) return null;
  const cdns = ownData(group, 'cdns');
  const normalized = Object.create(null);
  let count = 0;
  if (plainObject(cdns)) {
    for (const key of Object.keys(cdns).slice(0, MAX_CDNS)) {
      if (!/^[\w-]{1,64}$/.test(key)) continue;
      const cdn = ownData(cdns, key);
      const url = safeHttpsUrl(ownData(cdn, 'url') || ownData(cdn, 'link'));
      if (!url) continue;
      normalized[key] = {url};
      count++;
    }
  }
  const directUrl = safeHttpsUrl(ownData(group, 'url') || ownData(group, 'link'));
  if (!count && directUrl) {
    normalized.default = {url: directUrl};
    count = 1;
  }
  if (!count) return null;
  const requested = text(ownData(group, 'default_cdn'));
  const defaultCdn = requested && Object.hasOwn(normalized, requested) ? requested : Object.keys(normalized)[0];
  return {default_cdn: defaultCdn, cdns: normalized};
}

function normalizedFiles(rawFiles) {
  if (!plainObject(rawFiles)) return null;
  const files = Object.create(null);
  for (const key of ['hls', 'dash']) {
    const group = normalizedFileGroup(ownData(rawFiles, key));
    if (group) files[key] = group;
  }
  const progressive = ownData(rawFiles, 'progressive');
  if (Array.isArray(progressive)) {
    const values = [];
    const length = Math.min(ownData(progressive, 'length') || 0, MAX_PROGRESSIVE);
    for (let index = 0; index < length; index++) {
      const item = ownData(progressive, String(index));
      if (!plainObject(item)) continue;
      const url = safeHttpsUrl(ownData(item, 'url') || ownData(item, 'link'));
      if (!url) continue;
      const value = {url};
      for (const key of ['width', 'height']) {
        const dimension = Number(ownData(item, key));
        if (Number.isFinite(dimension) && dimension > 0 && dimension <= 16384) value[key] = dimension;
      }
      const quality = ownData(item, 'quality');
      if (typeof quality === 'string' || (typeof quality === 'number' && Number.isFinite(quality))) value.quality = quality;
      values.push(value);
    }
    if (values.length) files.progressive = values;
  }
  return Object.keys(files).length ? files : null;
}

function authenticatedPayload(config, routeId, {allowMissingVideoId = false} = {}) {
  if (!plainObject(config) || containsDrm(config)) return null;
  const video = ownData(config, 'video');
  if (!plainObject(video)) return null;
  const id = safeId(ownData(video, 'id'));
  if ((!id && !allowMissingVideoId) || (id && id !== routeId)) return null;
  const request = ownData(config, 'request');
  const rawFiles = ownData(request, 'files');
  const files = normalizedFiles(rawFiles);
  if (!files) return null;
  const resultVideo = {id: routeId};
  const title = shortTitle(ownData(video, 'title') || ownData(video, 'name'));
  if (title) resultVideo.title = title;
  const duration = Number(ownData(video, 'duration'));
  if (Number.isFinite(duration) && duration > 0 && duration <= 604800) resultVideo.duration = duration;
  return {video: resultVideo, request: {files}};
}

function clipPageConfiguration(target) {
  const vimeo = ownData(target, 'vimeo');
  const nested = ownData(vimeo, 'clip_page_config');
  const topLevel = ownData(target, 'clip_page_config');
  return [nested, topLevel].filter(plainObject);
}

function scriptLiteral(textValue, parseJson) {
  if (typeof textValue !== 'string' || !textValue) return [];
  const found = [];
  let quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = 0; index < textValue.length && found.length < MAX_SCRIPTS; index++) {
    const char = textValue[index], next = textValue[index + 1];
    if (lineComment) { if (char === '\n' || char === '\r') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (!/[A-Za-z_$]/.test(char) || (index > 0 && /[\w$]/.test(textValue[index - 1]))) continue;
    let nameEnd = index + 1;
    while (/[\w$]/.test(textValue[nameEnd] || '')) nameEnd++;
    const name = textValue.slice(index, nameEnd);
    if (name !== 'playerConfig' && name !== 'config') { index = nameEnd - 1; continue; }
    let equals = nameEnd;
    while (/\s/.test(textValue[equals] || '')) equals++;
    if (textValue[equals] !== '=' || textValue[equals + 1] === '=' || textValue[equals + 1] === '>') { index = nameEnd - 1; continue; }
    let start = equals + 1;
    while (/\s/.test(textValue[start] || '')) start++;
    if (textValue[start] !== '{') { index = equals; continue; }
    const stack = [];
    let jsonQuoted = false, jsonEscaped = false, tooDeep = false, end = -1;
    for (let index = start; index < textValue.length; index++) {
      const char = textValue[index];
      if (jsonQuoted) {
        if (jsonEscaped) jsonEscaped = false;
        else if (char === '\\') jsonEscaped = true;
        else if (char === '"') jsonQuoted = false;
        continue;
      }
      if (char === '"') { jsonQuoted = true; continue; }
      if (char === '{' || char === '[') {
        stack.push(char);
        if (stack.length > MAX_CONFIG_DEPTH) tooDeep = true;
      }
      else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '[';
        if (stack.pop() !== expected) { stack.length = 1; break; }
        if (!stack.length) { end = index + 1; break; }
      }
    }
    if (end < 0) { index = equals; continue; }
    if (!tooDeep && end - start <= MAX_SCRIPT_CHARS) try {
      const value = parseJson(textValue.slice(start, end));
      if (plainObject(value)) found.push(value);
    } catch {}
    index = end - 1;
  }
  return found.slice(0, MAX_SCRIPTS);
}

function inlineConfigurations(target, parseJson) {
  const document = safeProperty(target, 'document', target, ['Window']);
  const scripts = safeProperty(document, 'scripts', target, ['Document']);
  if (!scripts) return [];
  const length = Number(safeProperty(scripts, 'length', target, ['HTMLCollection'])) || 0;
  const values = [];
  let consumed = 0;
  for (let index = 0; index < Math.min(length, MAX_SCRIPTS); index++) {
    let script;
    if (Array.isArray(scripts)) script = ownData(scripts, String(index));
    else {
      const item = nativeMethod(target, 'HTMLCollection', 'item');
      if (typeof item === 'function') {
        try { script = Reflect.apply(item, scripts, [index]); } catch {}
      }
    }
    if (!script) continue;
    let srcAttribute = '';
    const getAttribute = nativeMethod(target, 'Element', 'getAttribute');
    if (typeof getAttribute === 'function') {
      try { srcAttribute = Reflect.apply(getAttribute, script, ['src']); } catch {}
    }
    const external = text(safeProperty(script, 'src', target, ['HTMLScriptElement'])) || text(srcAttribute);
    if (external) continue;
    const body = safeProperty(script, 'textContent', target, ['HTMLScriptElement', 'HTMLElement', 'Element', 'Node']);
    if (typeof body !== 'string') continue;
    consumed += body.length;
    if (consumed > MAX_SCRIPT_CHARS) break;
    values.push(...scriptLiteral(body, parseJson));
  }
  return values;
}

function wrapperConfigUrl(wrapper, routeId, target) {
  if (!objectLike(wrapper)) return '';
  const direct = text(ownData(wrapper, 'data-config-url'));
  if (direct) return safeConfigUrl(direct, routeId);
  const getter = nativeMethod(target, 'Element', 'getAttribute');
  if (typeof getter !== 'function') return '';
  try { return safeConfigUrl(Reflect.apply(getter, wrapper, ['data-config-url']), routeId); } catch { return ''; }
}

/**
 * Read a currently loaded, ID-matched Vimeo config for the one selected player.
 * `players` must be the caller's bounded list of known Vimeo player instances
 * or wrappers; this function never discovers players through page globals.
 */
export function ownedVimeoConfiguration(video, target, {
  pageUrl = '',
  players = [],
  parseJson = JSON.parse,
} = {}) {
  const id = routeVideoId(pageUrl);
  if (!id || !objectLike(video) || !objectLike(target) || typeof parseJson !== 'function') return null;
  if (mediaKeysPresent(video, target)) return null;
  const selected = selectedPlayer(video, players, target);
  if (!selected) return null;
  if (safeProperty(video, 'isConnected', target, ['Node']) === false ||
      safeProperty(selected.wrapper, 'isConnected', target, ['Node']) === false) return null;
  const playerMediaKeys = ownDescriptor(selected.player, 'mediaKeys');
  if (playerMediaKeys && (!Object.hasOwn(playerMediaKeys, 'value') || playerMediaKeys.value != null)) return null;

  const payloads = [];
  for (const key of ['playerConfig', 'config']) {
    const config = ownData(target, key);
    const payload = authenticatedPayload(config, id);
    if (payload) payloads.push(payload);
  }

  const configUrls = [];
  for (const clipPage of clipPageConfiguration(target)) {
    const clip = ownData(clipPage, 'clip');
    if (!plainObject(clip) || safeId(ownData(clip, 'id')) !== id) continue;
    const player = ownData(clipPage, 'player');
    if (!plainObject(player)) continue;
    const payload = authenticatedPayload(ownData(player, 'config'), id, {allowMissingVideoId: true});
    if (payload) payloads.push(payload);
    const url = safeConfigUrl(ownData(player, 'config_url'), id);
    if (url) configUrls.push(url);
  }

  payloads.push(...inlineConfigurations(target, parseJson)
    .map(config => authenticatedPayload(config, id)).filter(Boolean));

  const wrapperUrl = wrapperConfigUrl(selected.wrapper, id, target);
  if (wrapperUrl) configUrls.push(wrapperUrl);
  const distinctPayloads = new Map(payloads.map(payload => [JSON.stringify(payload), payload]));
  if (distinctPayloads.size === 1) return [...distinctPayloads.values()][0];
  if (distinctPayloads.size > 1) return null;
  const distinctUrls = [...new Set(configUrls)];
  return distinctUrls.length === 1 ? {id, configUrl: distinctUrls[0]} : null;
}
