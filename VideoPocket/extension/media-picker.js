// User initiated media picker.  This file is intentionally independent from
// page.js/popup.js so the background can serialize `startMediaPicker` into
// every frame without installing a permanent content script.

export const MEDIA_PICKER_PROTOCOL = 'video-pocket/media-picker';
export const MEDIA_PICKER_ACTIONS = Object.freeze({
  start: `${MEDIA_PICKER_PROTOCOL}/start`,
  selected: `${MEDIA_PICKER_PROTOCOL}/selected`,
  cancelled: `${MEDIA_PICKER_PROTOCOL}/cancelled`,
  expired: `${MEDIA_PICKER_PROTOCOL}/expired`,
});

// Pass this function to executeScript({allFrames:true}) when the popup closes
// or the user presses Esc in another frame.
export function cancelMediaPicker(options={}) {
  if(options.requestId && globalThis[Symbol.for('video-pocket.media-picker')]?.requestId!==options.requestId)return {ok:true};
  const state = globalThis[Symbol.for('video-pocket.media-picker')];
  if (state?.cancel) { state.cancel('cancelled'); return true; }
  return false;
}

/**
 * Function passed to chrome.scripting.executeScript({allFrames:true}).
 * Every value returned by this function is structured-clone safe.
 *
 * options: { frameId?, documentId?, requestId?, timeoutMs? }
 */
export function startMediaPicker(options = {}) {
  // Keep this function self-contained: Chrome serializes only the function
  // supplied to executeScript, not module bindings around it.
  const ACTIONS = {selected: 'video-pocket/media-picker/selected', cancelled: 'video-pocket/media-picker/cancelled', expired: 'video-pocket/media-picker/expired'};
  const requestId = String(options.requestId || `pick-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const frameId = options.frameId == null ? null : Number(options.frameId);
  const documentId = options.documentId == null ? null : String(options.documentId);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
  const stateKey = Symbol.for('video-pocket.media-picker');
  const previous = globalThis[stateKey];
  if (previous?.requestId && typeof previous.cancel === 'function') previous.cancel('replaced');

  const root = document.documentElement || document.body;
  if (!root) return Promise.resolve({ok: false, action: ACTIONS.expired, requestId, reason: 'no-document'});
  const registry = globalThis[Symbol.for('video-pocket.selection')];
  let videos = [],videosDirty=true,lastScan=0;
  const refreshVideos = (force=false) => {
    const time=Date.now();if(!force&&(!videosDirty||time-lastScan<150))return;
    videosDirty=false;lastScan=time;
    const next = [];
    const addCurrent = node => {
      if (!node || String(node.tagName).toLowerCase() !== 'video' || next.includes(node)) return;
      if ('isConnected' in node && !node.isConnected) return;
      try{if(globalThis[Symbol.for('video-pocket.mediaObserver')]?.isPresent?.(node)===false)return;}catch{}
      next.push(node);
    };
    const walkCurrent = scope => {
      try { scope.querySelectorAll?.('video').forEach(addCurrent); } catch {}
      try { scope.querySelectorAll?.('*').forEach(node => { if (node.shadowRoot) walkCurrent(node.shadowRoot); }); } catch {}
    };
    walkCurrent(document);
    for (const node of registry?.videos || []) addCurrent(node);
    videos = next;
  };
  refreshVideos(true);

  const identities = globalThis[Symbol.for('video-pocket.identities')] || (globalThis[Symbol.for('video-pocket.identities')] = {keys: new WeakMap(), next: 0});
  const keyOf = video => {
    if (!identities.keys.has(video)) identities.keys.set(video, ++identities.next);
    return identities.keys.get(video);
  };
  const candidateFor = video => {
    const registryIndex = Array.isArray(registry?.videos) ? registry.videos.indexOf(video) : -1;
    const index = registryIndex >= 0 ? registryIndex : videos.indexOf(video);
    const entry = registryIndex >= 0 ? registry.videos[registryIndex] : null;
    const source = () => { try { return video.currentSrc || video.src || video.querySelector?.('source')?.src || ''; } catch { return ''; } };
    const mediaObserver=globalThis[Symbol.for('video-pocket.mediaObserver')];let twitchOwned;
    let ownedTitle='';try{twitchOwned=mediaObserver?.twitchPlayerFor?.(video,videos);ownedTitle=twitchOwned?.title || mediaObserver?.titleFor?.(video,{includeAria:false}) || '';}catch{}
    const named=value=>{const text=String(value || '').replace(/\s+/g,' ').trim();if(!text)return '';try{if(mediaObserver?.isGenericTitle?.(text))return '';}catch{}return /^(?:(?:youtube|twitch|facebook|instagram|tiktok|twitter|bilibili|x)\s*[-:：|·]?\s*)?(?:(?:html5|embedded|嵌入式?|嵌入)\s*)?(?:video|media|影片|视频|視頻)\s*(?:player|播放器)?\s*\d*$/i.test(text)?'':text;};
    let modelTitle='',mediaIdentity='',selectionIdentity='';try{selectionIdentity=globalThis[Symbol.for('video-pocket.sourceEvidence')]?.collectMediaEvidence?.({video,root:document,pageUrl:location.href})?.identity?.key || '';const model=mediaObserver?.modelFor?.(video);modelTitle=named(model?.title);mediaIdentity=model?.id || selectionIdentity;}catch{}
    let platformTitle='';try{
      const page=new URL(location.href),owner=document.querySelector?.('#movie_player');
      if(/(^|\.)youtube\.com$/i.test(page.hostname)&&owner?.contains(video)){
        const response=owner.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse,id=page.searchParams.get('v') || page.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
        if(response?.videoDetails?.videoId&&(!id||response.videoDetails.videoId===id))platformTitle=named(response.videoDetails.title);
      }
    }catch{}
    let socialPage=false;try{const page=new URL(location.href);socialPage=/(^|\.)\b(?:x|twitter|reddit|tiktok|instagram|facebook|threads)\.(?:com|net)$/i.test(page.hostname)||/(^|\.)twitch\.tv$/i.test(page.hostname)&&/\/clips\/?$/i.test(page.pathname);}catch{}
    let title=[platformTitle,twitchOwned?.title,modelTitle,entry?.title,ownedTitle,video.title,video.getAttribute?.('data-video-title'),!socialPage&&videos.length===1?document.title:'',video.getAttribute?.('aria-label')].map(named).find(Boolean) || `Video ${index+1}`;
    try{const page=new URL(location.href),id=page.pathname.match(/^\/videos\/(\d+)/)?.[1];if(/(^|\.)twitch\.tv$/i.test(page.hostname)&&id&&(video.closest?.('[data-a-target="video-player"]')||videos.length===1))mediaIdentity='twitch-vod:'+id;}catch{}
    if(twitchOwned)mediaIdentity=`twitch-${twitchOwned.kind}:${twitchOwned.kind==='clip'?twitchOwned.slug:twitchOwned.id}`;
    try{const page=new URL(location.href),id=page.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || page.searchParams.get('bvid');if(/(^|\.)bilibili\.com$/i.test(page.hostname)&&id&&((()=>{let node=video;for(let depth=0;node&&depth<16;depth++){if(node.closest?.('#bilibili-player,#bilibiliPlayer,.bpx-player-container,.bilibili-player-video,bwp-video'))return true;const host=node.getRootNode?.()?.host;if(!host||host===node)break;node=host;}return false;})()||videos.length===1))mediaIdentity=`bilibili:${id}:${Math.max(1,Number(page.searchParams.get('p'))||1)}`;}catch{}
    if(mediaIdentity.startsWith('bilibili:')){const detail=globalThis.__INITIAL_STATE__?.videoData;if(detail?.bvid&&mediaIdentity.split(':')[1]===detail.bvid)title=named(detail.title)||title;}
    if(mediaIdentity.startsWith('bilibili:'))selectionIdentity=mediaIdentity;
    return {mediaKey: keyOf(video), localMediaIndex: index, frameId, documentId, frameUrl: location.href, title, url: source(),mediaIdentity,selectionIdentity};
  };
  let highlighted = null;
  let closed = false;
  let timer;
  let visibilityTimer;
  let resolveResult;
  const promise = new Promise(resolve => { resolveResult = resolve; });
  const overlay = document.createElement('div');
  overlay.setAttribute('data-video-pocket-media-picker', requestId);
  Object.assign(overlay.style, {position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '3px solid #2b85bf', background: 'rgba(26,115,232,.12)', boxSizing: 'border-box', display: 'none', borderRadius: '2px'});
  const label = document.createElement('div');
  Object.assign(label.style, {position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', background: '#2b85bf', color: '#fff', font: '12px/1.4 sans-serif', padding: '3px 6px', borderRadius: '3px', display: 'none', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'});
  label.textContent = 'Select video';
  const guide=document.createElement('div');
  Object.assign(guide.style,{position:'fixed',top:'12px',left:'50%',transform:'translateX(-50%)',zIndex:'2147483647',pointerEvents:'none',background:'#216b9f',color:'#fff',font:'13px/1.5 sans-serif',padding:'8px 14px',borderRadius:'7px',boxShadow:'0 2px 10px #0003',whiteSpace:'nowrap',display:frameId===0?'block':'none'});
  guide.textContent='Click a video, then reopen VideoPocket · Esc cancels';
  (document.body || root).append(overlay, label, guide);

  let observer;
  const cleanup = reason => {
    if (closed) return;
    closed = true; clearTimeout(timer);clearInterval(visibilityTimer);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove(); label.remove(); guide.remove();
    observer?.disconnect?.();
    if (globalThis[stateKey]?.requestId === requestId) delete globalThis[stateKey];
    if (reason === 'cancelled' || reason === 'replaced') resolveResult({ok: false, action: ACTIONS.cancelled, requestId, reason});
    else if (reason === 'expired') resolveResult({ok: false, action: ACTIONS.expired, requestId, reason});
  };
  const rect = video => { try { const r = video.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; } catch { return null; } };
  const blockedByDialog = video => {
    try{return [...document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"]')].some(dialog=>{
      if(dialog.contains?.(video))return false;
      const r=dialog.getBoundingClientRect?.();if(!r||r.width<=0||r.height<=0)return false;
      const style=globalThis.getComputedStyle?.(dialog);
      return !style || style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0;
    });}catch{return false;}
  };
  const interactiveOwner = node => {
    try { return node?.closest?.('a,button,[role="button"],input,select,textarea') || null; } catch { return null; }
  };
  const chooseFromEvent = (event,force=false) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    refreshVideos(force||path.some(node=>String(node?.tagName).toLowerCase()==='video'&&!videos.includes(node)));
    const direct = path.find(node => videos.includes(node)&&!blockedByDialog(node));
    if (direct) return direct;
    const x = Number(event.clientX), y = Number(event.clientY);
    let stack = [];
    try { stack = document.elementsFromPoint?.(x, y) || []; } catch {}
    // A player control is often a sibling overlay of <video>. Permit that
    // button only when its immediate player container owns exactly one video;
    // a card/link over a video must never select the covered video.
    const top = stack[0];
    const control=interactiveOwner(top);
    if (control) {
      const button=control.tagName?.toLowerCase()==='button'||control.getAttribute?.('role')==='button';
      if(!button)return null;
      let parent = control.parentElement;
      while (parent && parent !== document.documentElement && parent !== document.body) {
        const owned = videos.filter(video => { try { return parent.contains(video); } catch { return false; } });
        if(owned.length>1)return null;
        if (owned.length === 1&&!blockedByDialog(owned[0])) {
          const r=rect(owned[0]);
          return r&&x>=r.left&&x<=r.left+r.width&&y>=r.top&&y<=r.top+r.height?owned[0]:null;
        }
        parent = parent.parentElement;
      }
      return null;
    }
    const fromStack = stack.find(node => videos.includes(node)&&!blockedByDialog(node));
    if (fromStack) return fromStack;
    return videos.find(video => { const r = rect(video); return r && !blockedByDialog(video) && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }) || null;
  };
  const paint = video => {
    highlighted = video || null;
    const r = video && !blockedByDialog(video) && rect(video);
    if (!r) { overlay.style.display = 'none'; label.style.display = 'none'; return; }
    Object.assign(overlay.style, {display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`});
    Object.assign(label.style, {display: 'block', left: `${Math.max(0, r.left)}px`, top: `${Math.max(0, r.top - 24)}px`});
    label.textContent = `Selected: ${candidateFor(video).title}`;
  };
  const onPointerMove = event => paint(chooseFromEvent(event));
  const onPointerDown = event => {
    const video = chooseFromEvent(event,true);
    if (!video) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const onClick = event => {
    const video = chooseFromEvent(event,true);
    if (!video) return;
    // Capture only while this explicit picker is active.  This prevents a
    // card/link's navigation or a video click from reaching the site.
    event.preventDefault(); event.stopImmediatePropagation();
    const selected = candidateFor(video);
    cleanup('selected');
    resolveResult({ok: true, action: ACTIONS.selected, requestId, ...selected, selector: {mediaKey: selected.mediaKey, frameId, documentId, localMediaIndex: selected.localMediaIndex, url: selected.url || null}});
  };
  const onKeyDown = event => { if (event.key === 'Escape' || event.key === 'Esc') { event.preventDefault(); event.stopImmediatePropagation(); cleanup('cancelled'); } };
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  try { observer = new MutationObserver(() => {videosDirty=true;}); observer.observe(document.documentElement || document, {subtree: true, childList: true}); } catch {}
  timer = setTimeout(() => cleanup('expired'), timeoutMs);
  visibilityTimer=setInterval(()=>{if(highlighted&&blockedByDialog(highlighted))paint(null);},200);
  globalThis[stateKey] = {requestId, cancel: () => cleanup('replaced')};
  return promise;
}

// Alias makes the intended executeScript API discoverable to background.js.
export const mediaPickerScript = startMediaPicker;

export function rememberedMediaSelector(selection) {
  if (!selection || selection.mediaKey == null) return null;
  return {mediaKey: selection.mediaKey, frameId: selection.frameId ?? null, documentId: selection.documentId ?? null, localMediaIndex: Number.isInteger(selection.localMediaIndex) ? selection.localMediaIndex : null, url: selection.url ?? selection.sourceUrl ?? null};
}

export function matchRememberedMedia(snapshot, remembered) {
  const selector = rememberedMediaSelector(remembered);
  if (!selector || !snapshot) return null;
  if (selector.frameId != null && Number(selector.frameId) !== Number(snapshot.frameId)) return null;
  if (selector.documentId != null && String(selector.documentId) !== String(snapshot.documentId)) return null;
  const videos = Array.isArray(snapshot.videos) ? snapshot.videos : [];
  const index = videos.findIndex(v => String(v?.mediaKey) === String(selector.mediaKey));
  if (index < 0) return null;
  const currentUrl = videos[index]?.url ?? videos[index]?.src ?? null;
  if (selector.url && selector.url !== currentUrl) return null;
  return {...videos[index], localMediaIndex: index, frameId: selector.frameId, documentId: selector.documentId};
}
