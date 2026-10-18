import {
  collectMediaEvidence,
  exposeSourceEvidence,
} from "./media-evidence.js";
import { createMediaModelStore, extractMediaModels } from "./media-models.js";

const OBSERVER_SYMBOL = Symbol.for("video-pocket.mediaObserver");
const MAX_GRAPH = 512,
  MAX_OBJECT_URLS = 256,
  MAX_TEXT = 512 * 1024,
  TTL = 5 * 60 * 1000;
const http = (raw, base = "") => {
  try {
    const u = new URL(raw, base || undefined);
    return /^https?:$/.test(u.protocol) ? u.href : "";
  } catch {
    return "";
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

export function installMediaObserver(target = globalThis) {
  if (target[OBSERVER_SYMBOL]?.sourcesFor) return target[OBSERVER_SYMBOL];
  const bodyUrl = new WeakMap(),
    xhrUrls = new WeakMap(),
    bufferUrl = new WeakMap();
  const objectUrls = new Map(),
    graph = new Map(),
    patterns = [],
    known = new Map(),
    mediaSources = new WeakMap(),
    sourceBuffers = new WeakMap(),
    wrappers = [];
  const modelStore = createMediaModelStore();
  const now = () => Date.now();
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
  const recordJson = (value, url) => {
    try {
      modelStore.merge(extractMediaModels(value, { baseUrl: url }));
    } catch {}
  };
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
          rememberBody(value, url, type);
          if (name === "text") {
            parseText(value, url, type);
            if (
              /json/i.test(type) ||
              /^\s*(?:for\s*\(;;\);\s*)?[\[{]/.test(value)
            ) {
              try {
                recordJson(
                  JSON.parse(String(value).replace(/^\s*for\s*\(;;\);\s*/, "")),
                  url,
                );
              } catch {}
            }
          }
          if (name === "json") recordJson(value, url);
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
              const url = xhrUrls.get(xhr);
              if (!url) return;
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
                  try {
                    recordJson(
                      JSON.parse(
                        String(xhr.responseText).replace(
                          /^\s*for\s*\(;;\);\s*/,
                          "",
                        ),
                      ),
                      url,
                    );
                  } catch {}
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
    const raw = video?.currentSrc || video?.src;
    const direct =
      http(raw, target.location?.href) ||
      (/^blob:/i.test(String(raw || "")) ? String(raw) : "");
    const present=objectUrls.get(direct);if(present)present.at=now();prune();
    let associatedRoot = false;
    const add = (url, kind, evidence) => {
      if (url && !candidates.some((c) => c.url === url))
        candidates.push({ url, kind, evidence, downloadable: true });
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
            /mpd/i.test(model.manifestUrl) ? "dash" : "hls",
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
            add(item.url, item.kind, item.evidence);
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
    for (const restore of wrappers.splice(0))
      try {
        restore();
      } catch {}
    objectUrls.clear();
    graph.clear();
    known.clear();
    if (target[OBSERVER_SYMBOL]?.dispose === dispose)
      try {
        delete target[OBSERVER_SYMBOL];
      } catch {
        target[OBSERVER_SYMBOL] = undefined;
      }
  };
  const api = {
    sourcesFor,
    modelFor: (video) => modelStore.modelFor(video, target.location?.href),
    scanDocument: () =>
      modelStore.scanDocument(target.document, target.location?.href),
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
