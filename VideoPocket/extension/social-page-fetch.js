const SAFE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

function serviceForPage(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebook";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "dailymotion.com" || host.endsWith(".dailymotion.com")) return "dailymotion";
  } catch {}
  return "";
}

function serviceForMedia(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const suffix = (domain) => host === domain || host.endsWith(`.${domain}`);
    if(suffix('dailymotion.com')||suffix('dmcdn.net'))return 'dailymotion';
    if (suffix("fbcdn.net") || suffix("fbsbx.com") || suffix("facebook.com")) return "facebook";
    if (
      suffix("tiktokcdn.com") || suffix("tiktokcdn-us.com") || suffix("tiktokcdn-eu.com") ||
      suffix("tiktokcdn-in.com") || suffix("tiktokv.com") || suffix("byteoversea.com") ||
      suffix("ibytedtos.com") || suffix("ibyteimg.com") || suffix("muscdn.com") || suffix("tiktok.com")
    ) return "tiktok";
  } catch {}
  return "";
}

function safeError(message = "social page fetch failed") {
  return new Error(message);
}

export async function socialPageFetch(action, options = {}) {
  const root = globalThis;
  const safeHeaders = (headers) => {
    const result = {};
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = headers?.get?.(name);
      if (value != null) result[name] = String(value).slice(0, 4096);
    }
    return result;
  };
  const safeUrl = (raw) => {
    try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return undefined; }
  };
  const error = (message) => new Error(message);
  const pageService = (raw) => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebook";
      if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
      if (host === "dailymotion.com" || host.endsWith(".dailymotion.com")) return "dailymotion";
    } catch {}
    return "";
  };
  const mediaService = (raw) => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      const suffix = (domain) => host === domain || host.endsWith(`.${domain}`);
      if(suffix('dailymotion.com')||suffix('dmcdn.net'))return 'dailymotion';
      if (suffix("fbcdn.net") || suffix("fbsbx.com") || suffix("facebook.com")) return "facebook";
      if (suffix("tiktokcdn.com") || suffix("tiktokcdn-us.com") || suffix("tiktokcdn-eu.com") || suffix("tiktokcdn-in.com") || suffix("tiktokv.com") || suffix("byteoversea.com") || suffix("ibytedtos.com") || suffix("ibyteimg.com") || suffix("muscdn.com") || suffix("tiktok.com")) return "tiktok";
    } catch {}
    return "";
  };
  const key = Symbol.for("video-pocket.socialPageFetch");
  const state = root[key] || (root[key] = { sessions: new Map(), pending: 0, ttl: 120000, max: 4 });
  const now = () => Date.now();
  const cleanIdle = () => {
    for (const [handle, session] of state.sessions) {
      if (now() - session.last > state.ttl) {
        try { session.controller.abort(); } catch {}
        try { Promise.resolve(session.reader?.cancel()).catch(() => {}); } catch {}
        state.sessions.delete(handle);
      }
    }
  };
  const remove = (handle) => {
    const session = state.sessions.get(handle);
    if (!session) return;
    state.sessions.delete(handle);
    try { session.controller.abort(); } catch {}
    try { Promise.resolve(session.reader?.cancel()).catch(() => {}); } catch {}
  };
  const randomHandle = () => {
    try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }
  };
  const validate = (input) => {
    let page, media;
    try {
      page = new URL(input.referer || location.href, location.href);
      media = new URL(input.url, location.href);
    } catch { throw error("invalid social media context"); }
    const current = new URL(location.href);
    if (current.protocol !== "https:" || page.protocol !== "https:" || media.protocol !== "https:" ||
      page.origin !== current.origin || page.username || page.password || media.username || media.password)
      throw error("invalid social media context");
    const pageKind = pageService(page.href), mediaKind = mediaService(media.href);
    if (!pageKind || pageKind !== mediaKind) throw error("media host is not allowed");
    const method = String(input.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw error("method is not allowed");
    const range = input.range == null ? "" : String(input.range);
    if (range && !/^bytes=\d+-\d*$/.test(range)) throw error("range is not allowed");
    return { page, media, method, range };
  };
  cleanIdle();
  if (action === "open") {
    const checked = validate(options);
    if (state.sessions.size + state.pending >= state.max) throw error("too many active social reads");
    state.pending++;
    const controller = new AbortController();
    const headers = {};
    if (checked.range) headers.Range = checked.range;
    let timer;
    let response;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(error("social response timeout")); }, 20000); });
      response = await Promise.race([fetch(checked.media.href, { method: checked.method, headers, credentials: "include", signal: controller.signal }), timeout]);
    } catch {
      throw error("social response failed");
    } finally { if (timer) clearTimeout(timer); state.pending--; }
    const result = { status: response.status, headers: safeHeaders(response.headers), url: safeUrl(response.url || checked.media.href), done: checked.method === "HEAD" || !response.body };
    if (checked.method === "GET" && response.body && response.status >= 200 && response.status < 300) {
      const handle = randomHandle();
      const reader = response.body.getReader();
      state.sessions.set(handle, { controller, reader, last: now(), leftover: null, reading: false });
      result.handle = handle;
    } else {
      try { controller.abort(); } catch {}
      try { await Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {}
      result.done = true;
    }
    return result;
  }
  if (action === "read") {
    const handle = typeof options.handle === "string" ? options.handle : "";
    const session = state.sessions.get(handle);
    if (!session) throw error("social read handle expired");
    if (session.reading) throw error("social read is busy");
    session.reading = true; session.last = now();
    const limit = 256 * 1024;
    try {
      let item;
      if (session.leftover?.byteLength) { item = { done: false, value: session.leftover }; session.leftover = null; }
      else {
        let timer;
        try {
          const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(error("social read timeout")), 20000); });
          item = await Promise.race([session.reader.read(), timeout]);
        } catch { remove(handle); throw error("social read failed"); }
        finally { if (timer) clearTimeout(timer); }
      }
      if (item.done) { remove(handle); return { data: [], done: true }; }
      const value = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value || []);
      const take = Math.min(limit, value.byteLength);
      const data = value.slice(0, take);
      if (take < value.byteLength) session.leftover = value.slice(take);
      session.last = now();
      return { data: [...data], done: false };
    } finally { session.reading = false; }
  }
  if (action === "cancel") {
    if (typeof options.handle === "string") remove(options.handle);
    return { done: true };
  }
  throw error("unknown social fetch action");
}

export async function socialPageResponse(rpc, { url, referer, context, options = {} } = {}) {
  if (typeof rpc !== "function") throw new TypeError("rpc is required");
  let page, media;
  try { page = new URL(referer || context?.referer); media = new URL(url); } catch { throw safeError("invalid social media context"); }
  if (page.protocol !== "https:" || media.protocol !== "https:" || page.username || page.password || media.username || media.password || !serviceForPage(page.href) || serviceForPage(page.href) !== serviceForMedia(media.href)) throw safeError("media host is not allowed");
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw safeError("method is not allowed");
  const signal = options.signal;
  if (signal?.aborted) throw signal.reason;
  const range = options.range || options.headers?.Range || options.headers?.range;
  const requestOptions = { method, url: media.href, referer: page.href, ...(range ? { range } : {}) };
  let abortDuringOpen;
  let abortListener;
  const openPromise = rpc({ action: "open", options: requestOptions });
  if (signal) abortDuringOpen = new Promise((_, reject) => { abortListener = () => reject(signal.reason); signal.addEventListener("abort", abortListener, { once: true }); });
  let opened;
  try { opened = await (abortDuringOpen ? Promise.race([openPromise, abortDuringOpen]) : openPromise); }
  catch (error) {
    openPromise.then((late) => late?.handle && rpc({ action: "cancel", options: { handle: late.handle } }).catch(() => {}), () => {});
    if (signal?.aborted) throw signal.reason;
    throw error;
  } finally { if (signal && abortListener) signal.removeEventListener("abort", abortListener); }
  let closed = false;
  let handle = opened.handle;
  let streamController;
  let abortAfterOpen;
  const cleanupAbort = () => { if (signal && abortAfterOpen) signal.removeEventListener("abort", abortAfterOpen); };
  const cancel = async () => {
    if (closed) return;
    closed = true;
    cleanupAbort();
    if (handle) { try { Promise.resolve(rpc({ action: "cancel", options: { handle } })).catch(()=>{}); } catch {} }
  };
  const finish = () => { closed = true; cleanupAbort(); };
  const stream = method === "HEAD" || opened.done ? null : new ReadableStream({
    start(controller){streamController=controller;},
    async pull(controller) {
      if(closed)return;
      try {
        const item = await rpc({ action: "read", options: { handle } });
        if(closed)return;
        if (item.data?.length) controller.enqueue(new Uint8Array(item.data));
        if (item.done) { finish(); controller.close(); }
      } catch { if(!closed){await cancel();try{controller.error(safeError("social read failed"));}catch{}} }
    },
    async cancel() { await cancel(); },
  });
  if (signal && stream) {
    abortAfterOpen = () => {
      const reason = signal.reason || safeError("social request aborted");
      try { streamController?.error(reason); } catch {}
      void cancel();
    };
    signal.addEventListener("abort", abortAfterOpen, { once: true });
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(opened.headers || {})) if (SAFE_HEADERS.includes(name)) headers.set(name, value);
  const response=new Response(stream, { status: opened.status, headers });
  // Retain the final path for relative HLS/DASH references after a redirect.
  // The MAIN bridge has already removed query parameters from this URL.
  if(opened.url)try{Object.defineProperty(response,'url',{value:String(opened.url)});}catch{}
  return response;
}
