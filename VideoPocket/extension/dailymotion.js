const MAX_METADATA_BYTES = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{3,128}$/;

const sourceError = (message = "Dailymotion 影片來源不可用") =>
  Object.assign(new Error(message), { code: "SOURCE_UNAVAILABLE" });

function hostIs(host, root) {
  const value = String(host || "").toLowerCase();
  return value === root || value.endsWith(`.${root}`);
}

function validId(value) {
  const id = String(value || "");
  return ID.test(id) ? id : "";
}

export function dailymotionVideoId(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { return ""; }
  if (url.protocol !== "https:" || !(hostIs(url.hostname, "dailymotion.com") || url.hostname.toLowerCase() === "dai.ly")) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname.toLowerCase() === "dai.ly") return parts.length === 1 && !/^(?:playlist|player|video)$/i.test(parts[0]) ? validId(parts[0]) : "";
  if (hostIs(url.hostname, "dailymotion.com") && parts[0]?.toLowerCase() === "video") return validId(parts[1]);
  if (hostIs(url.hostname, "dailymotion.com") && parts[0]?.toLowerCase() === "player") return validId(url.searchParams.get("video"));
  return "";
}

function exactText(value) {
  return String(value ?? "").trim();
}

export function dailymotionContext(document, rawUrl) {
  const route = dailymotionVideoId(rawUrl);
  if (route) return { id: route, url: String(rawUrl), title: exactText(document?.querySelector?.("#media-title")?.textContent) };
  let page;
  try { page = new URL(String(rawUrl || "")); } catch { return null; }
  if (page.protocol !== "https:" || !hostIs(page.hostname, "dailymotion.com")) return null;
  if (page.pathname.split("/").filter(Boolean)[0]?.toLowerCase() !== "playlist") return null;
  const title = exactText(document?.querySelector?.("#media-title")?.textContent);
  if (!title) return null;
  const ids = new Set();
  for (const anchor of document?.querySelectorAll?.("a[href]") || []) {
    if (exactText(anchor.textContent) !== title) continue;
    const id = dailymotionVideoId(anchor.href || anchor.getAttribute?.("href"));
    if (id) ids.add(id);
  }
  return ids.size === 1 ? { id: [...ids][0], url: String(rawUrl), title } : null;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function absolute(value, base) {
  if (typeof value !== "string" || !value.trim() || value.length > 16384) return "";
  try {
    const url = new URL(value, base || undefined);
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

function mediaType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

export function qualityMediaSources(qualities, base = "") {
  const versions = [];
  let dash = "", hls = "",visited=0;
  const addVersion = (item) => {
    if(++visited>128)return;
    if (!item || typeof item !== "object") return;
    const type = mediaType(item.type || item.mime || item.mime_type);
    const source = absolute(item.url || item.src, base);
    if (!source) return;
    if (type === "application/dash+xml") { dash ||= source; return; }
    if (type === "application/x-mpegurl" || type === "application/vnd.apple.mpegurl" || type === "application/mpegurl") { hls ||= source; return; }
    if (type !== "video/mp4" && type !== "video/webm") return;
    if (!versions.some((entry) => entry.url === source)) {
      const height = number(item.height || item.height_px || item.video_height);
      const width = number(item.width || item.width_px || item.video_width);
      if(versions.length<32)versions.push({ url: source, ...(width ? { width } : {}), ...(height ? { height } : {}) });
    }
  };
  const visit = (value) => {
    if (Array.isArray(value)) { for (const item of value.slice(0,128)) addVersion(item); return; }
    if (!value || typeof value !== "object") return;
    for (const [quality,item] of Object.entries(value).slice(0,32)) if (Array.isArray(item)) for (const entry of item.slice(0,128)) {if(visited>=128)break;addVersion(entry&&typeof entry==='object'?{...entry,height:entry.height || (/^\d{2,4}$/.test(quality)?Number(quality):undefined)}:entry);}
    addVersion(value);
  };
  visit(qualities);
  return { versions, ...(dash || hls ? { manifestUrl: dash || hls, manifestType: dash ? "dash" : "hls" } : {}) };
}

async function readBounded(response) {
  if (!response?.ok)throw Object.assign(new Error(`Dailymotion metadata HTTP ${response?.status || 0}`),{status:response?.status});
  if (!response.body?.getReader) throw sourceError();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value || []);
      total += chunk.byteLength;
      if (total > MAX_METADATA_BYTES) throw sourceError("Dailymotion metadata exceeds size limit");
      chunks.push(chunk);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(all);
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

export async function resolveDailymotion(platform, request) {
  const id = validId(platform?.id);
  if (!id || typeof request !== "function") throw sourceError();
  const endpoint = `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(id)}?app=com.dailymotion.neon`;
  let response;
  const options = { method: "GET" };
  if (platform?.referer) options.referer = String(platform.referer);
  if (platform?.signal) options.signal = platform.signal;
  response = await request(endpoint, options);
  let metadata;
  try { metadata = JSON.parse(await readBounded(response)); } catch (error) { if (error?.code === "SOURCE_UNAVAILABLE" || error?.status || ['AbortError','TimeoutError'].includes(error?.name)) throw error; throw sourceError(); }
  if(metadata?.error)throw sourceError(String(metadata.error.title || metadata.error.raw_message || 'Dailymotion 未提供播放資料').slice(0,180));
  if (String(metadata?.id || "") !== id) throw sourceError('Dailymotion metadata 與目前影片 ID 不符');
  const sources = qualityMediaSources(metadata.qualities, endpoint);
  if (!sources.versions.length && !sources.manifestUrl) throw sourceError();
  return { site: "embedded", id, title: String(metadata.title || ""), duration: number(metadata.duration), ...sources };
}
