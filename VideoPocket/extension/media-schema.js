// Shared, conservative vocabulary for media metadata.  Keep this module free
// of DOM/Worker dependencies so JSON, Worker and document scanners agree on
// what deserves a bounded metadata copy.
const STRONG_FIELDS = new Set([
  "videoUrl", "video_url", "videoURL", "video_versions", "mediaDefinitions",
  "video_dash_manifest", "dash_manifest", "dash_manifest_xml_string", "contentUrl",
  "playable_url", "playable_url_quality_hd", "playable_url_dash", "playAddr", "play_addr", "downloadAddr", "download_addr",
  "browser_native_sd_url", "browser_native_hd_url", "manifestUrl", "manifestURL",
  "manifestXml", "streamUrl", "streamURL", "sourceURL", "sourceUrl", "playbackUrl", "playbackURL",
  "videoQualities", "playbackAccessToken",
  "PlayAddrStruct", "bitrateInfo", "bitrate_info",
  "video_dash_manifest_url", "videoUrlManifest", "dash_manifest_url",
  "progressive_urls", "progressive_url", "dash_manifest_urls", "manifest_url",
  "dash_manifests", "manifest_xml", "hls_playlist_urls", "hls_playlist_url",
  "noRedirectPlaybackUrl",
  "videoDeliveryLegacyFields", "videoDeliveryResponseResult",
]);
const CONTEXT_FIELDS = new Set([
  "video", "media", "play", "hls", "dash", "sources", "source", "progressive",
  "qualities", "quality", "variants", "files", "video_info", "videoInfo",
  "broadcasts", "broadcast", "clip",
]);
// X cards carry the playback binding in a small identity envelope. These
// names are intentionally explicit; generic `id`/`title` remain ordinary
// application data and must not make an arbitrary payload media-shaped.
const IDENTITY_FIELDS = new Set([
  "broadcast_id", "broadcastId", "broadcast_url", "broadcast_media_key",
  "broadcast_media_id", "broadcast_title", "media_key", "mediaKey",
  "rest_id", "id_str", "card", "binding_values", "string_value",
  "expanded_url", "key", "value", "tweet_result", "tweetResult", "quoted_status_result",
  "retweeted_status_result", "entities", "extended_entities",
  "__typename", "videoId", "video_id", "videoID", "videoFBID", "aweme_id",
  "media_id", "mediaID", "shortcode", "code", "url_list", "urlList",
  "content_type", "mime_type", "duration_millis", "duration_ms", "full_text",
  "tweet_id", "unwound_url", "broadcast_width", "broadcast_height",
]);
// Retention is deliberately broader than admission: parsers need these
// attributes after a payload has been recognized, but a title, dimension or
// format flag alone must never enqueue ordinary application/analytics data.
const DETAIL_FIELDS = new Set([
  "id", "title", "name", "desc", "text", "alt_text", "status",
  "video_title", "video_duration", "length_in_second", "playable_duration_in_ms",
  "original_width", "original_height", "height_px", "width_px", "video_height", "video_width",
  "original_info", "originalInfo", "contentType", "format", "remote", "adaptive", "defaultQuality",
  "request", "cdns", "default_cdn", "urls", "video_data", "videoData", "videoVersion",
]);
const BROADCAST_IDENTITY_FIELDS = new Set([
  "broadcast_id", "broadcastId", "broadcast_url", "broadcast_media_key",
  "broadcast_media_id", "broadcast_title", "media_key", "mediaKey",
]);
const SHAPE_FIELDS = new Set(["src", "url", "link", "uri", "location", "type", "mime", "width", "height", "bitrate", "duration"]);
const GENERIC_SOURCE_FIELDS = new Set(["videoUrl", "video_url", "manifestUrl", "manifestURL", "streamUrl", "streamURL", "sourceURL", "sourceUrl", "playbackUrl", "playbackURL"]);
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STRONG_ALIASES = ["videoDelivery\\w*", "videoQualities", "playbackAccessToken", "broadcast_by_rest_id", "broadcasts?", "broadcast_(?:id|url|media_key|media_id|title)"];
const STRONG_RE = new RegExp(`\\"(?:${[...STRONG_FIELDS].map(escape).join("|")}|${STRONG_ALIASES.join("|")})\\"\\s*:`, "i");
const CONTEXT_RE = new RegExp(`\\"(?:${[...CONTEXT_FIELDS].map(escape).join("|")})\\"\\s*:`, "i");
const strongFieldPattern = new RegExp(`^(?:${[...STRONG_FIELDS].map(escape).join("|")}|${STRONG_ALIASES.join("|")})$`, "i");
const contextFieldPattern = new RegExp(`^(?:${[...CONTEXT_FIELDS].map(escape).join("|")})$`, "i");
const identityNames = new Set([...IDENTITY_FIELDS].map(key => key.toLowerCase()));
const shapeNames = new Set([...SHAPE_FIELDS].map(key => key.toLowerCase()));
const detailNames = new Set([...DETAIL_FIELDS].map(key => key.toLowerCase()));

export const MEDIA_SCHEMA = Object.freeze({ STRONG_FIELDS, CONTEXT_FIELDS, IDENTITY_FIELDS, BROADCAST_IDENTITY_FIELDS, SHAPE_FIELDS, DETAIL_FIELDS });
export const isStrongMediaField = key => STRONG_FIELDS.has(String(key)) || strongFieldPattern.test(String(key));
export const isContextMediaField = key => CONTEXT_FIELDS.has(String(key)) || contextFieldPattern.test(String(key));
export const isMediaField = key => isStrongMediaField(key) || isContextMediaField(key);
export const isMediaIdentityField = key => identityNames.has(String(key).toLowerCase());
export const isBroadcastIdentityField = key => BROADCAST_IDENTITY_FIELDS.has(String(key));
export const isMediaShapeField = key => shapeNames.has(String(key).toLowerCase());
export const isMediaMetadataField = key => isMediaField(key) || isMediaIdentityField(key) || isMediaShapeField(key) || detailNames.has(String(key).toLowerCase());

// A URL alone is intentionally insufficient.  The caller may use this gate
// before JSON.parse to avoid copying unrelated application state.
export function isMediaPayloadText(text) {
  if (typeof text !== "string") return false;
  return STRONG_RE.test(text) || (CONTEXT_RE.test(text) && /"(?:src|url|link|uri|location|sourceURL|sourceUrl|videoUrl|video_url|manifestUrl|hls|dash|progressive)"\s*:/i.test(text));
}

export function hasMediaStructure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (GENERIC_SOURCE_FIELDS.has(String(key)) || isStrongMediaField(key) && /^(?:videoQualities|playbackAccessToken)$/.test(String(key))) return true;
    if (["sources", "progressive", "qualities", "variants", "files"].includes(String(key)) && Array.isArray(child) && child.length) return true;
    if (["play", "hls", "dash"].includes(String(key)) && (typeof child === "string" || (child && typeof child === "object"))) return true;
  }
  return false;
}

// Conservative, getter-free admission test for deferred metadata. Generic
// URL/duration/id fields are insufficient unless they occur under a known
// media container or an explicit X broadcast binding.
export function hasMediaPayload(value) {
  const seen=new WeakSet();let remaining=4096;
  const data=(object,key)=>{try{return Object.getOwnPropertyDescriptor(object,key)?.value;}catch{return undefined;}};
  const visit=(node,depth=0,inMedia=false)=>{
    if(!node||typeof node!=='object'||depth>32||remaining--<=0||seen.has(node))return false;
    let proto,keys;try{proto=Object.getPrototypeOf(node);keys=Object.keys(node);}catch{return false;}
    if(!Array.isArray(node)&&proto!==Object.prototype&&proto!==null)return false;
    seen.add(node);
    const bindingKey=data(node,'key'),bindingValue=data(data(node,'value'),'string_value');
    if(typeof bindingKey==='string'&&isBroadcastIdentityField(bindingKey)&&typeof bindingValue==='string'&&bindingValue)return true;
    for(const key of keys){
      if(remaining--<=0)break;const child=data(node,key);
      if(isStrongMediaField(key)&&(typeof child==='string'?!!child.trim():child&&typeof child==='object'))return true;
      if(/^(?:hls|dash)$/i.test(key)&&typeof child==='string'&&/^https?:\/\//i.test(child))return true;
      if(inMedia&&/^(?:src|url|link|uri|location)$/.test(key)&&typeof child==='string'&&child.trim())return true;
      if(child&&typeof child==='object'&&visit(child,depth+1,inMedia||isContextMediaField(key)))return true;
    }
    return false;
  };
  return visit(value);
}

export function isMediaObjectKey(key, value) {
  const name = String(key);
  if (STRONG_FIELDS.has(name) || CONTEXT_FIELDS.has(name)) return true;
  // Shape fields are meaningful only under an explicitly media-shaped object;
  // this predicate is used by bounded copiers after their parent is known.
  return isMediaShapeField(name) && typeof value === "string";
}
