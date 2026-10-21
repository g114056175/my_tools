import { collectMediaEvidence } from "./media-evidence.js";
import {ownedPlayerMetadata} from './media-binding.js';
import {qualityMediaSources} from './dailymotion.js';

const MAX_MODELS = 128;
const MAX_VALUE = 1024 * 1024;
const TTL = 5 * 60 * 1000;
const MAX_MODEL_BYTES = 2 * 1024 * 1024;
const ID_KEYS = ["aweme_id", "videoId", "video_id", "videoFBID", "media_id", "mediaID", "id", "shortcode", "code", "videoID"];
const MEDIA_PARENT_ID_KEYS = ["aweme_id", "video_id", "videoId", "videoFBID", "media_id", "mediaID"];
const responseResultOf = (value) => {
  const result = value?.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
  return result && typeof result === "object" ? result : null;
};
const marker = (value) =>
  value &&
  typeof value === "object" &&
  (value.__typename === "Video" ||
    value.__typename === "VideoObject" ||
    value.videoDeliveryLegacyFields ||
    responseResultOf(value) ||
    value.video_versions ||
    value.qualities ||
    value.video_dash_manifest ||
    value.request?.files ||
    value.play?.hls || value.play?.dash || value.play?.progressive ||
    value.contentUrl ||
    value.video_url ||
    value.playable_url ||
    value.playAddr ||
    value.play_addr ||
    value.PlayAddrStruct ||
    value.downloadAddr ||
    value.download_addr ||
    value.bitrateInfo ||
    value.bitrate_info);
const string = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";
const number = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value)
    : undefined;
const url = (value, base) => {
  if (!string(value) || value.length>16384) return "";
  try {
    const result = new URL(value, base || undefined);
    return /^https?:$/.test(result.protocol) ? result.href : "";
  } catch {
    return "";
  }
};

function aliasesOf(value) {
  return [
    ...new Set(ID_KEYS.map((key) => typeof value?.[key]==='number'?String(value[key]):string(value?.[key]).slice(0,256)).filter(Boolean)),
  ];
}

function version(value, base) {
  if (!value || typeof value !== "object") return null;
  const source = url(value.url || value.src || value.contentUrl, base);
  if (!source) return null;
  return {
    url: source,
    width: number(value.width),
    height: number(value.height),
    id: string(value.id || value.type) || undefined,
  };
}

function sourceUrls(value, base, depth = 0, out = []) {
  if (depth > 5 || out.length >= 32 || value == null) return out;
  if (typeof value === "string") {
    const source = url(value, base);
    if (source && !out.includes(source)) out.push(source);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) sourceUrls(item, base, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const key of ["url", "src", "link", "uri", "url_list", "urlList", "UrlList"])
    if (Object.hasOwn(value, key)) sourceUrls(value[key], base, depth + 1, out);
  return out;
}

function descriptor(value, base, parentAliases = [], parentTitle = '') {
  if (!marker(value)) return null;
  const rawDelivery =
    value.videoDeliveryLegacyFields &&
    typeof value.videoDeliveryLegacyFields === "object"
      ? value.videoDeliveryLegacyFields
      : null;
  const rawResponse = responseResultOf(value);
  const playerFiles=value.request?.files,play=value.play,qualitySources=qualityMediaSources(value.qualities,base);
  const ownAliases = [...new Set([...aliasesOf(value),...(playerFiles?aliasesOf(value.video):[]),...(String(value.uri||'').match(/^\/videos\/(\d+)$/)?.slice(1)||[])])];
  const matches=child=>!aliasesOf(child).length||!ownAliases.length||aliasesOf(child).some(alias=>ownAliases.includes(alias));
  const delivery = matches(rawDelivery) ? rawDelivery : null;
  const response = matches(rawResponse) ? rawResponse : null;
  const aliases = [
    ...new Set([...ownAliases, ...aliasesOf(delivery), ...aliasesOf(response), ...parentAliases]),
  ];
  const versions = [
    ...qualitySources.versions,
    ...(Array.isArray(value.video_versions) ? value.video_versions : []),
    ...(Array.isArray(delivery?.video_versions) ? delivery.video_versions : []),
    ...(Array.isArray(playerFiles?.progressive)?playerFiles.progressive:[]),
    ...(Array.isArray(play?.progressive)?play.progressive:[]).map(v=>({...v,url:v.link || v.url})),
    ...(Array.isArray(response?.progressive_urls)
      ? response.progressive_urls.map((item) => ({ url: item?.progressive_url }))
      : []),
  ]
    .map((item) => version(item, base))
    .filter(Boolean).slice(0,32);
  for (const key of [
    "browser_native_sd_url",
    "browser_native_hd_url",
    "contentUrl",
    "video_url",
    "playable_url",
    "downloadAddr",
    "download_addr",
    "playAddr",
    "play_addr",
    "PlayAddrStruct",
  ]) {
    for (const candidate of sourceUrls(value[key] || delivery?.[key], base)) {
      if (!versions.some((item) => item.url === candidate))
        versions.push({ url: candidate });
    }
  }
  for (const entry of [...(Array.isArray(value.bitrateInfo) ? value.bitrateInfo : []), ...(Array.isArray(value.bitrate_info) ? value.bitrate_info : [])]) {
    for (const key of ["downloadAddr", "download_addr", "PlayAddr", "playAddr", "play_addr"]) {
      for (const candidate of sourceUrls(entry?.[key], base)) {
        if (!versions.some((item) => item.url === candidate))
          versions.push({ url: candidate, width: number(entry?.PlayAddr?.Width || entry?.width), height: number(entry?.PlayAddr?.Height || entry?.height) });
      }
    }
  }
  for (const key of ["downloadAddr", "download_addr", "playAddr", "play_addr"]) {
    for (const candidate of sourceUrls(value.video?.[key], base)) {
      if (!versions.some((item) => item.url === candidate)) versions.push({ url: candidate });
    }
  }
  versions.splice(32);
  const rawManifestXml = string(
    value.video_dash_manifest ||
      value.manifestXml ||
      delivery?.dash_manifest_xml_string ||
      (Array.isArray(response?.dash_manifests)?response.dash_manifests:[]).find((item) => string(item?.manifest_xml))?.manifest_xml,
  );
  const manifestXml=rawManifestXml.length<=512*1024?rawManifestXml:'';
  const cdnUrl=group=>group?.cdns?.[group.default_cdn]?.url || Object.values(group?.cdns || {}).find(c=>c?.url)?.url;
  const responseDashUrl = (Array.isArray(response?.dash_manifest_urls)?response.dash_manifest_urls:[])
    .map((item) => url(item?.manifest_url, base))
    .find(Boolean) || '';
  const responseHlsUrl = (Array.isArray(response?.hls_playlist_urls)?response.hls_playlist_urls:[])
    .map((item) => url(item?.hls_playlist_url, base))
    .find(Boolean) || '';
  const legacyManifestUrl = url(
    value.video_dash_manifest_url ||
      value.manifestUrl ||
      delivery?.dash_manifest_url ||
      value.dash ||
      value.hls,
    base,
  ) || url(play?.hls?.link || cdnUrl(playerFiles?.hls) || play?.dash?.link || cdnUrl(playerFiles?.dash),base);
  const manifestUrl = responseDashUrl || legacyManifestUrl || responseHlsUrl || qualitySources.manifestUrl;
  const manifestType = responseDashUrl
    ? "dash"
    : responseHlsUrl && !legacyManifestUrl
      ? "hls"
      : qualitySources.manifestType;
  if (!versions.length && !manifestXml && !manifestUrl)
    return null;
  return {
    id: aliases[0] || undefined,
    aliases,
    manifestXml: manifestXml || undefined,
    manifestUrl: manifestUrl || undefined,
    manifestType,
    versions,
    duration: number(
      value.duration ||
        value.length_in_second ||
        value.video_duration ||
        value.playable_duration_in_ms ||
        delivery?.playable_duration_in_ms,
    )
      ? number(
          value.playable_duration_in_ms || delivery?.playable_duration_in_ms,
        )
        ? Number(
            value.playable_duration_in_ms || delivery?.playable_duration_in_ms,
          ) / 1000
        : number(value.duration || value.length_in_second || value.video_duration)
      : undefined,
    width: number(value.width || value.original_width || delivery?.width),
    height: number(value.height || value.original_height || delivery?.height),
    title: string(value.name || value.title || value.desc || value.video?.title || value.video?.desc || parentTitle).slice(0,512),
    updatedAt: Date.now(),
  };
}

export function extractMediaModels(
  value,
  { baseUrl = "", budget = MAX_VALUE } = {},
) {
  const models = [],
    visited = new WeakSet();
  let used = 0;
  const visit = (node, depth = 0, parentAliases = [], parentTitle = '') => {
    if (
      !node ||
      typeof node !== "object" ||
      depth > 32 ||
      visited.has(node) ||
      used > budget
    )
      return;
    visited.add(node);
    used += Object.keys(node).length * 16;
    if (marker(node)) {
      const model = descriptor(node, baseUrl, parentAliases, parentTitle);
      if (model) models.push(model);
    }
    const ownMediaIds = MEDIA_PARENT_ID_KEYS.map((key) => typeof node[key] === "number" ? String(node[key]) : string(node[key])).filter(Boolean).slice(0, 4);
    // Public ItemStruct payloads use id rather than aweme_id. Propagate it
    // only when the nested video explicitly confirms the same ID.
    if(node.id&&node.video?.id&&String(node.id)===String(node.video.id)&&marker(node.video))ownMediaIds.push(String(node.id));
    const entries = Array.isArray(node) ? Array.from(node, (child) => ["", child]) : Object.entries(node);
    for (const [key, child] of entries)
      if (child && typeof child === "object") {
        const isMediaChild = ["video", "media", "video_data", "videoData"].includes(key);
        const aliases = isMediaChild ? [...parentAliases, ...ownMediaIds] : parentAliases;
        const title = isMediaChild && ownMediaIds.length ? string(node.desc || node.title || node.name || parentTitle) : parentTitle;
        visit(child, depth + 1, aliases, title);
      }
  };
  visit(value);
  return models;
}

export function createMediaModelStore({
  maxModels = MAX_MODELS,
  ttl = TTL,
  parseJson = JSON.parse,
} = {}) {
  const models = [],
    associations = new WeakMap(),
    scriptCache = new WeakMap();
  let totalBytes = 0;
  const modelBytes = (model) => JSON.stringify(model).length;
  const merge = (incoming) => {
    for (const candidate of incoming || []) {
      const same = models.filter(
        (model) =>
          model.aliases.some((alias) => candidate.aliases.includes(alias)) &&
          (!model.id || !candidate.id || model.id === candidate.id || candidate.aliases.every(id=>model.aliases.includes(id)) || model.aliases.every(id=>candidate.aliases.includes(id))),
      );
      const current = same.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (current) {
        const updated={...current};
        for (const [key, value] of Object.entries(candidate))
          if (
            !(key==='id'&&current.id&&candidate.aliases.every(id=>current.aliases.includes(id))) &&
            value !== undefined &&
            value !== "" &&
            !(Array.isArray(value) && !value.length)
          )
            updated[key] = value;
        updated.aliases = [
          ...new Set([...current.aliases, ...candidate.aliases]),
        ].slice(0,32);
        updated.updatedAt = Date.now();
        const nextBytes=totalBytes-modelBytes(current)+modelBytes(updated);
        if(nextBytes>MAX_MODEL_BYTES)continue;
        Object.assign(current,updated);totalBytes=nextBytes;
      } else {
        const copy = { ...candidate, updatedAt: Date.now() };
        const bytes = modelBytes(copy);
        if (totalBytes + bytes > MAX_MODEL_BYTES) continue;
        models.push(copy);
        totalBytes += bytes;
      }
    }
    while (models.length > maxModels) totalBytes -= modelBytes(models.shift());
    return incoming || [];
  };
  const prune = () => {
    const cutoff = Date.now() - ttl;
    for (let i = models.length - 1; i >= 0; i--)
      if (models[i].updatedAt < cutoff)
        totalBytes -= modelBytes(models.splice(i, 1)[0]);
  };
  const scanDocument = (document, baseUrl = "") => {
    prune();
    if (!document?.querySelectorAll) return [];
    const found = [];
    for (const script of document.querySelectorAll(
      'script[type="application/json"],script[type="application/ld+json"]',
    )) {
      const text = String(script.textContent || "");
      if (text.length > MAX_VALUE) continue;
      if(!/video_versions|videoDelivery|video_dash_manifest|contentUrl|video_url|playable_url|VideoObject|"progressive"|"qualities"|"play"\s*:|"files"\s*:|playAddr|downloadAddr|bitrateInfo|url_list/i.test(text))continue;
      let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
      const fingerprint = `${text.length}:${hash>>>0}`;
      const cached = scriptCache.get(script);
      if (cached?.fingerprint === fingerprint && Date.now()-cached.at<ttl) continue;
      let parsed;
      try {
        parsed = parseJson(text.replace(/^\s*for\s*\(;;\);\s*/, ""));
      } catch {
        continue;
      }
      const extracted = merge(extractMediaModels(parsed, { baseUrl }));
      scriptCache.set(script, { fingerprint, at:Date.now() });
      found.push(...extracted);
      const scope = script.closest?.(
        'figure,article,[role="article"],[data-video-id],[data-media-id]',
      );
      const videos = scope
        ? [...(scope.querySelectorAll?.("video") || [])]
        : [];
      if (videos.length === 1) {
        const identity = collectMediaEvidence({
          video: videos[0],
          root: scope,
          pageUrl: baseUrl,
        }).identity;
        const applicable = extracted.filter(
          (model) => !identity.id || model.aliases.includes(identity.id),
        );
        if (applicable.length === 1)
          associations.set(videos[0], {
            model: applicable[0],
            key: identity.key || identity.id || "",
            source:videos[0].currentSrc || videos[0].src || '',
          });
      }
    }
    return found;
  };
  const modelFor = (video, pageUrl = "") => {
    prune();
    const root = video?.ownerDocument || undefined;
    const identity = collectMediaEvidence({ video, root, pageUrl }).identity;
    const owned=ownedPlayerMetadata(video);
    if(owned.payloads.length)merge(owned.payloads.flatMap(value=>extractMediaModels(value,{baseUrl:pageUrl})));
    if(owned.ids.length){
      // A post ID and a CDN resource ID can both name the same video. All
      // observed IDs must agree with one model; two actual posts remain an
      // ambiguity and cannot borrow one another's download source.
      const exact=models.filter(model=>owned.ids.every(id=>model.aliases.includes(id)));
      // A real player's explicit ID outranks the route (feeds and reels can
      // retain the old URL). Never fall back to a different route model.
      return exact.length===1?exact[0]:null;
    }
    const associated = associations.get(video);
    if (associated && Date.now()-associated.model.updatedAt<ttl && associated.key === (identity.key || identity.id || "") && associated.source===(video?.currentSrc || video?.src || ''))
      return associated.model;
    if (associated) associations.delete?.(video);
    return (
      models.find(
        (model) => identity.id && model.aliases.includes(identity.id),
      ) || null
    );
  };
  return {
    merge,
    scanDocument,
    modelFor,
    diagnosticsFor: (video,pageUrl='') => {
      prune();const ids=ownedPlayerMetadata(video).ids,identity=collectMediaEvidence({video,root:video?.ownerDocument,pageUrl}).identity;
      const matches=models.filter(model=>ids.length?ids.every(id=>model.aliases.includes(id)):identity.id&&model.aliases.includes(identity.id));
      return {models:models.length,playerIds:ids.length,routeIdentity:!!identity.id,matches:matches.length,reason:!models.length?'no-model':!ids.length&&!identity.id?'no-player-identity':!matches.length?'identity-unmatched':matches.length>1?'ambiguous-model':'matched'};
    },
    models: () => (
      prune(),
      models.map((model) => ({
        ...model,
        aliases: [...model.aliases],
        versions: model.versions.map((version) => ({ ...version })),
      }))
    ),
  };
}
