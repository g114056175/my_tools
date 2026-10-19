// Self-contained functions executed in MAIN after the extension is invoked.
// Bilibili is an SPA: __INITIAL_STATE__ and textTracks can survive a route
// change.  Resolve the identity from the current URL first, then accept state
// only when it explicitly agrees with that URL and the selected page number.
export function resolveBilibiliIdentity(rawUrl,state={},pageNumber){
  let url;try{url=new URL(rawUrl || location.href);}catch{return {valid:false,reason:'invalid-url'};}
  const host=String(url.hostname).toLowerCase();if(!/(^|\.)bilibili\.com$/.test(host))return {valid:false,reason:'not-bilibili'};
  const urlBvid=url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || url.searchParams.get('bvid') || '';
  const detail=state?.videoData || {},stateBvid=String(detail.bvid || state.bvid || '');
  // A stale state from the previous SPA route must never be used as a
  // substitute for the current URL identity.
  if(!urlBvid || !stateBvid || stateBvid!==urlBvid)return {valid:false,reason:'bvid-mismatch',urlBvid,stateBvid};
  const requested=Math.max(1,Number(pageNumber ?? url.searchParams.get('p'))||1),pages=Array.isArray(detail.pages)?detail.pages:[];
  const part=pages[requested-1];
  const cid=part?.cid ?? (requested===1 ? detail.cid : undefined);
  if(!Number.isFinite(Number(cid)) || Number(cid)<=0)return {valid:false,reason:'cid-missing',bvid:urlBvid,page:requested};
  return {valid:true,bvid:urlBvid,cid:Number(cid),page:requested};
}

export async function pageSnapshot(mediaIndex=0){
  // executeScript serializes this function into MAIN; keep injected helpers
  // inside it instead of relying on module scope.
  const resolveIdentity=(rawUrl,state={},pageNumber)=>{
    let url;try{url=new URL(rawUrl || location.href);}catch{return {valid:false,reason:'invalid-url'};}
    const urlBvid=url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || url.searchParams.get('bvid') || '';
    const detail=state?.videoData || {},stateBvid=String(detail.bvid || state.bvid || '');
    if(!urlBvid || !stateBvid || stateBvid!==urlBvid)return {valid:false,reason:'bvid-mismatch',urlBvid,stateBvid};
    const requested=Math.max(1,Number(pageNumber ?? url.searchParams.get('p'))||1),pages=Array.isArray(detail.pages)?detail.pages:[],part=pages[requested-1];
    const cid=part?.cid ?? (requested===1 ? detail.cid : undefined);
    if(!Number.isFinite(Number(cid)) || Number(cid)<=0)return {valid:false,reason:'cid-missing',bvid:urlBvid,page:requested};
    return {valid:true,bvid:urlBvid,cid:Number(cid),page:requested};
  };
  const instagramEmbedded=shortcode=>{
    const wanted=String(shortcode||'');if(!wanted)return null;
    const find=(value,depth=0)=>{
      if(!value||depth>24)return null;
      if(Array.isArray(value)){for(const item of value){const found=find(item,depth+1);if(found)return found;}return null;}
      if(typeof value!=='object')return null;
      const media=value.xig_polaris_media;
      if(media&&typeof media==='object'){
        const gated=media.if_not_gated_logged_out;
        if(String(media.code||media.shortcode||'')===wanted||String(gated?.code||gated?.shortcode||'')===wanted)return gated||media;
      }
      for(const item of Object.values(value)){const found=find(item,depth+1);if(found)return found;}return null;
    };
    for(const node of document.querySelectorAll('script[type="application/json"][data-sjs]'))try{
      const product=find(JSON.parse(node.textContent||''));if(!product)continue;
      const versions=(Array.isArray(product.video_versions)?product.video_versions:[]).map(v=>({url:typeof v?.url==='string'?v.url:'',width:Number(v?.width)||0,height:Number(v?.height)||0,id:v?.id||v?.type})).filter(v=>/^https?:\/\//i.test(v.url)).sort((a,b)=>b.width*b.height-a.width*a.height);
      return {versions,dash:typeof product.video_dash_manifest==='string'?product.video_dash_manifest:null,duration:Number(product.video_duration)||0,width:Number(product.original_width)||0,height:Number(product.original_height)||0};
    }catch{}return null;
  };
  const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const player=document.querySelector('#movie_player');
  const animePage=/(^|\.)ani\.gamer\.com\.tw$/.test(String(location.hostname).toLowerCase());
  const animeMain=v=>animePage&&v?.getAttribute?.('id')==='ani_video_html5_api';
  const videos=roots.flatMap(root=>[...root.querySelectorAll('video')]).sort((a,b)=>Number(animeMain(b))-Number(animeMain(a)) || Number(!!player?.contains(b))-Number(!!player?.contains(a)));
  mediaIndex=Math.max(0,Math.min(Number(mediaIndex)||0,videos.length-1));const video=videos[mediaIndex];
  let response,activeTrack;
  try{response=player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;activeTrack=player?.getOption?.('captions','track');}catch{}
  const id=new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];if(id&&response?.videoDetails?.videoId!==id)response=null;
  const mainResponse=response;if(video&&player?.querySelector('video')&&!player.contains(video))response=null;
  const label=t=>typeof t?.name==='string'?t.name:t?.name?.simpleText || t?.name?.runs?.map(r=>r.text).join('') || '';
  const captionParameters=raw=>{try{const u=new URL(raw),encoded=u.pathname.match(/\/tts_params\/([^/]+)/)?.[1];return encoded?new URLSearchParams(decodeURIComponent(encoded)):u.searchParams;}catch{return new URLSearchParams();}};
  const renderer=response?.captions?.playerCaptionsTracklistRenderer,captions=renderer?.captionTracks || [];
  const defaultIndex=renderer?.defaultCaptionTrackIndex ?? renderer?.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0]?.defaultCaptionTrackIndex;
  const activeId=activeTrack?.vssId || activeTrack?.vss_id || activeTrack?.id;
  const sameLanguage=captions.filter(t=>t.languageCode===activeTrack?.languageCode&&(t.kind==='asr')===(activeTrack?.kind==='asr'));
  const tracks=captions.map((t,i)=>({language:t.languageCode,name:label(t) || t.languageCode,url:t.baseUrl,vssId:t.vssId,pageTrackId:t.vssId || `youtube:${i}`,pageTrackIndex:i,captionName:captionParameters(t.baseUrl).get('name') || '',automatic:t.kind==='asr',source:'youtube-page',default:Number.isInteger(defaultIndex)&&i===defaultIndex,active:!!activeTrack&&!activeTrack.translationLanguage&&(activeId?t.vssId===activeId:label(activeTrack)?label(activeTrack)===label(t)&&t.languageCode===activeTrack.languageCode:sameLanguage.length===1&&sameLanguage[0]===t)}));
  let title=mainResponse?.videoDetails?.title || document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || document.title;
  const animeTitle=animePage?String(document.title || '').replace(/\s*線上看\s*-\s*巴哈姆特動畫瘋\s*$/,'').trim():'';
  const candidates=videos.map((v,i)=>({title:animeMain(v)?animeTitle:(player?.contains(v)?mainResponse?.videoDetails?.title || title:v.getAttribute('aria-label') || v.title || v.getAttribute('data-mwtitle') || v.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || (videos.length===1?title:`影片 ${i+1}`)),url:v.currentSrc || v.src,referer:location.href}));
  const source=v=>v.currentSrc || v.src || v.querySelector('source')?.src || '';
  const http=raw=>{try{const u=new URL(raw,location.href);return /^https?:$/.test(u.protocol)&&raw?u.href:null;}catch{return null;}};
  const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/\.(mpd|m3u8)(?:\?|$)/i.test(u));
  let platform,captionStatus;
  const sourceObserver=window[Symbol.for('video-pocket.mediaObserver')];let embeddedModel;
  try{sourceObserver?.scanDocument?.();embeddedModel=video&&sourceObserver?.modelFor?.(video);if(embeddedModel)platform={...embeddedModel,site:'embedded'};}catch{}
  const currentUrl=new URL(location.href),igHost=/(^|\.)instagram\.com$/i.test(currentUrl.hostname),igCode=currentUrl.pathname.match(/^\/(?:reel|p|tv)\/([^/?#]+)/i)?.[1];
  if(!platform&&video&&videos.length===1&&igHost&&igCode){
    const embedded=instagramEmbedded(igCode),best=embedded?.versions?.[0];
    if(best?.url){candidates[0].adapterDownloadUrl=best.url;candidates[0].title=title;}
    if(embedded)platform={site:'instagram',id:igCode,shortcode:igCode,title,duration:embedded.duration,width:embedded.width,height:embedded.height,versions:embedded.versions.map(v=>({url:v.url,width:v.width||embedded.width,height:v.height||embedded.height,id:v.id})),manifestXml:embedded.dash || undefined};
  }
  const twitchHost=/(^|\.)twitch\.tv$/i.test(currentUrl.hostname),twitchId=currentUrl.pathname.match(/^\/videos\/(\d+)/i)?.[1];
  let twitchPlayers=[];
  if(twitchHost&&twitchId){
    // Resolve playback access inside the extension, not through the site's
    // fetch implementation or its page CSP. Other videos/ads do not disable
    // the identified main player.
    const owned=videos.filter(v=>{try{return !!v.closest('[data-a-target="video-player"]');}catch{return false;}});
    // Twitch can keep old/new internal video elements during a player swap.
    // They belong to the same route VOD, not separate posts in a feed.
    twitchPlayers=owned.length?owned:videos.length===1?videos:[];
    for(const v of twitchPlayers)candidates[videos.indexOf(v)].adapterDownloadUrl=currentUrl.href;
    if(!videos.length || twitchPlayers.includes(video)){
      platform={site:'twitch',id:twitchId,title,duration:Number.isFinite(video?.duration)?video.duration:0};
    }
  }
  const instances=[window.hls,window.player];try{if(typeof hls!=='undefined')instances.push(hls);if(typeof player!=='undefined')instances.push(player);}catch{}
  // Query existing Video.js players only. Calling videojs(id) would initialize
  // or alter a player; the registry and source getters leave playback alone.
  const videojsPlayers=[];
  try{videojsPlayers.push(...(window.videojs?.getAllPlayers?.() || Object.values(window.videojs?.getPlayers?.() || {})));}catch{}
  // The production Video.js bundle is module-scoped and does not publish a
  // window.videojs registry.  Its player is still attached to the video (or
  // to the .video-js/video-js wrapper), so collect those existing instances
  // without calling the Video.js factory or changing playback state.
  const addVideoJsPlayer=instance=>{if(instance&&!videojsPlayers.includes(instance))videojsPlayers.push(instance);};
  for(const v of videos)try{addVideoJsPlayer(v.player);}catch{}
  try{for(const wrapper of document.querySelectorAll('.video-js,video-js'))try{addVideoJsPlayer(wrapper.player);}catch{}}catch{}
  const configured=[];
  if(videos.length===1)for(const script of document.scripts){if(script.src)continue;for(const block of script.textContent.matchAll(/new\s+[\w.]*ExternalSubtitle\s*\(\s*\{([^}]+)\}/g)){const field=key=>block[1].match(new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]+)['"]`))?.[1];const url=http(field('url')),language=field('language');if(url&&language)configured.push({url,language,name:language});}}
  const registry={videos,tracks:new Map()};
  const playerOwnership=(instance,target)=>{
    let tech;
    try{tech=instance?.tech_;if(typeof tech==='function')tech=tech.call(instance);}catch{tech=undefined;}
    let techElement;
    try{techElement=tech?.el?.();}catch{}
    if(!techElement)try{techElement=tech?.el_;}catch{}
    // A tech element is the strongest ownership signal.  If it points at a
    // different video, never fall back to that instance's wrapper.
    if(techElement)return techElement===target?'exact':null;
    let element;
    try{element=instance?.el?.();}catch{}
    if(element===target)return 'exact';
    if(element?.contains?.(target)){
      const contained=videos.filter(v=>{try{return element.contains(v);}catch{return false;}});
      return contained.length===1&&contained[0]===target?'wrapper':null;
    }
    return null;
  };
  const readVideoJsSource=instance=>{
    const readHttp=fn=>{try{return http(fn());}catch{return null;}};
    let tech,vhs;
    try{tech=instance?.tech_;if(typeof tech==='function')tech=tech.call(instance);}catch{}
    try{vhs=tech?.vhs;}catch{}
    const direct=[
      ()=>vhs?.source_?.src,()=>vhs?.source_?.uri,()=>vhs?.source_?.resolvedUri,
      ()=>vhs?.playlists?.main?.uri,()=>vhs?.playlists?.master?.uri,
      ()=>vhs?.playlistController_?.mainPlaylistLoader_?.main.uri,
      ()=>vhs?.playlist?.uri,
      ()=>instance?.source_?.src,()=>instance?.source_?.uri,()=>instance?.source_?.resolvedUri,
      ()=>instance?.masterPlaylist_?.uri,()=>instance?.mainPlaylist_?.uri,
      ()=>instance?.masterPlaylist?.uri,()=>instance?.mainPlaylist?.uri,
      ()=>instance?.playlists?.main?.uri,()=>instance?.playlists?.master?.uri,
      ()=>instance?.playlistController_?.mainPlaylistLoader_?.main.uri,
      ()=>instance?.vhs?.playlist?.uri,
    ];
    for(const getter of direct){const value=readHttp(getter);if(value)return value;}
    // These are normal Video.js runtime APIs and are deliberately read-only;
    // they are fallback signals after the active VHS source fields above.
    for(const getter of [()=>instance?.currentSource?.()?.src,()=>instance?.currentSrc?.(),()=>instance?.currentSources?.()?.map(s=>s?.src).find(src=>http(src))]){const value=readHttp(getter);if(value)return value;}
    return null;
  };
  const bilibiliPage=/(^|\.)bilibili\.com$/.test(String(location.hostname).toLowerCase());
  const identities=window[Symbol.for('video-pocket.identities')] ||= {keys:new WeakMap(),next:0};
  for(const [i,v] of videos.entries()){
    if(!identities.keys.has(v))identities.keys.set(v,++identities.next);
    const candidate=candidates[i];candidate.mediaKey=identities.keys.get(v);candidate.url=source(v);candidate.downloadUrl=candidate.adapterDownloadUrl || null;delete candidate.adapterDownloadUrl;
    try{candidate.mediaIdentity=sourceObserver?.modelFor?.(v)?.id || window[Symbol.for('video-pocket.sourceEvidence')]?.collectMediaEvidence?.({video:v,root:document,pageUrl:location.href})?.identity?.key || '';}catch{}
    if(twitchId&&twitchPlayers.includes(v))candidate.mediaIdentity='twitch-vod:'+twitchId;
    if(player?.contains(v)&&response?.videoDetails?.videoId || /(^|\.)bilibili\.com$/.test(location.hostname)&&videos.length===1)candidate.downloadUrl=location.href;
    if(!candidate.downloadUrl){
      for(const instance of videojsPlayers)try{
        if(!playerOwnership(instance,v))continue;
        candidate.downloadUrl=http(readVideoJsSource(instance));
        if(candidate.downloadUrl)break;
      }catch{}
      if(!candidate.downloadUrl)for(const instance of [...instances,v.hls])try{if(instance&&(instance.media===v || instance.getVideoElement?.()===v)){candidate.downloadUrl=http(instance.url || instance.getSource?.());if(candidate.downloadUrl)break;}}catch{}
      // A stale welcome/ad <source> must not preempt the active VHS playlist.
      candidate.downloadUrl ||= http(source(v)) || http(v.src) || [...v.querySelectorAll('source')].map(s=>http(s.src)).find(Boolean) || null;
      candidate.downloadUrl ||= ['data-hls-url','data-dash-url','data-src'].map(key=>http(v.getAttribute(key))).find(Boolean) || null;
      if(!candidate.downloadUrl)try{const discovered=sourceObserver?.sourcesFor?.(v);candidate.discoveryReason=discovered?.reason || '';const sources=discovered?.candidates?.filter(item=>item.downloadable!==false) || [];if(sources.length===1){candidate.downloadUrl=http(sources[0].url);candidate.sourceType=sources[0].kind;}else if(sources.length>1)candidate.discoveryReason='ambiguous-source';}catch{}
      if(!candidate.downloadUrl&&videos.length===1&&!sourceObserver){const unique=[...new Set(resources)];if(unique.length===1)candidate.downloadUrl=unique[0];}
    }
    // Wikimedia intentionally renders a video placeholder before a user plays it.
    if(v.hasAttribute('data-mwtitle')&&/(^|\.)wikimedia\.org$/.test(location.hostname)){
      try{
        const api=new URL('/w/api.php',location.origin);api.search=new URLSearchParams({action:'query',titles:'File:'+v.getAttribute('data-mwtitle'),prop:'videoinfo',viprop:'url|size|derivatives|timedtext',format:'json',formatversion:'2'});
        const res=await fetch(api,{signal:AbortSignal.timeout(10000)});if(res.ok){const data=await res.json(),file=data.query?.pages?.[0]?.videoinfo?.[0];candidate.downloadUrl ||= http(file?.url);candidate.duration=file?.duration;candidate.externalTracks=(file?.timedtext || []).map(t=>({language:t.srclang || t.lang || 'und',name:t.label || t.title || t.srclang,url:http(t.src || t.url),source:'texttrack',automatic:false})).filter(t=>t.url);}
      }catch{}
    }
    // Bilibili's player may retain old TextTrack objects after SPA navigation.
    // Its API is the authoritative source; do not expose those stale objects.
    const mapped=bilibiliPage?[]:[...v.textTracks].flatMap((t,j)=>{
      if(!['captions','subtitles'].includes(t.kind))return [];
      const element=[...v.querySelectorAll('track')].find(e=>e.track===t),matching=configured.filter(c=>c.language.toLowerCase()===t.language.toLowerCase());
      return [{language:t.language || 'und',name:t.label&&t.label!=='null'?t.label:t.language || '字幕',url:element?.src || (matching.length===1?matching[0].url:undefined),pageTrackId:`html:${j}`,pageTrackIndex:j,active:t.mode==='showing',default:!!element?.default,source:'texttrack'}];
    });
    for(const external of candidate.externalTracks || [])if(!mapped.some(t=>t.url===external.url))mapped.push({...external,pageTrackId:`external:${mapped.length}`,pageTrackIndex:mapped.length});
    registry.tracks.set(v,mapped);delete candidate.externalTracks;
  }
  if(!captions.length){tracks.length=0;tracks.push(...(registry.tracks.get(video) || []));}
  window[Symbol.for('video-pocket.selection')]=registry;
  if(video&&/(^|\.)anime1\.me$/.test(location.hostname)){
    const apiRequest=video.getAttribute('data-apireq');
    if(apiRequest&&apiRequest.length<=16384)platform={site:'anime1',apiRequest,title};
  }
  if(video&&response?.videoDetails?.videoId){platform={site:'youtube',id:response.videoDetails.videoId,title:response.videoDetails.title,duration:Number(response.videoDetails.lengthSeconds),streamingData:response.streamingData,playerConfig:response.playerConfig,resources:performance.getEntriesByType('resource').filter(r=>/\.googlevideo\.com\/videoplayback/.test(r.name)).map(r=>r.name),visitorData:window.ytcfg?.get?.('VISITOR_DATA'),playerUrl:window.ytcfg?.get?.('PLAYER_JS_URL')};}
  if(video&&bilibiliPage&&videos.length===1){
    const pageUrl=new URL(location.href),routeBvid=pageUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || pageUrl.searchParams.get('bvid') || '';
    let state=window.__INITIAL_STATE__ || {},pageNumber=Math.max(1,Number(pageUrl.searchParams.get('p')) || 1),identity=resolveIdentity(location.href,state,pageNumber),freshDetail;
    // A stale/missing SPA state must not disable the current video. Resolve it
    // from Bilibili's public view API using only the bvid in the current URL.
    if(!identity.valid){try{
      const urlBvid=routeBvid;
      if(urlBvid){const api=new URL('https://api.bilibili.com/x/web-interface/view');api.search=new URLSearchParams({bvid:urlBvid});const r=await fetch(api,{credentials:'include',signal:AbortSignal.timeout(10000)}),value=await r.json();if(value.code===0&&String(value.data?.bvid||'')===urlBvid){freshDetail=value.data;state={videoData:freshDetail};identity=resolveIdentity(location.href,state,pageNumber);}}
    }catch{}}
    const candidateDetail=freshDetail || state.videoData || {},detail=String(candidateDetail.bvid||'')===routeBvid?candidateDetail:{},part=detail.pages?.[pageNumber-1],bvid=routeBvid || undefined,cid=identity.valid?identity.cid:0;
    let data;
    // Never reuse __playinfo__: it can belong to the previous SPA route.
    if(identity.valid)try{const api=new URL('https://api.bilibili.com/x/player/playurl');api.search=new URLSearchParams({bvid,cid,qn:'80',fnval:'4048',fnver:'0',fourk:'1'});const r=await fetch(api,{credentials:'include',signal:AbortSignal.timeout(10000)});const value=await r.json();if(value.code===0&&String(value.data?.bvid||bvid)===bvid&&(!value.data?.cid||Number(value.data.cid)===cid))data=value.data;}catch{}
    const cleanTitle=value=>String(value || '').trim(),validTitle=value=>value&&!/^\d{11,}$/.test(value),heading=document.querySelector('h1.video-title,.video-info-title h1,h1[title]'),metaTitle=cleanTitle(document.querySelector('meta[property="og:title"]')?.content);
    title=[cleanTitle(detail.title),cleanTitle(heading?.getAttribute('title')),cleanTitle(heading?.textContent),metaTitle,cleanTitle(title).replace(/[_\s-]*(?:哔哩哔哩|嗶哩嗶哩)(?:[_\s-]*bilibili)?$/i,'')].find(validTitle) || 'Bilibili 影片';
    candidates[mediaIndex].title=title;
    const parts=(detail.pages || []).map((entry,i)=>({page:i+1,cid:Number(entry.cid)||0,title:cleanTitle(entry.part)||`P${i+1}`,duration:Number(entry.duration)||0}));
    if(!parts.length&&Number(detail.cid)>0)parts.push({page:1,cid:Number(detail.cid),title:cleanTitle(detail.title)||'P1',duration:Number(detail.duration)||0});
    platform=bvid?{site:'bilibili',bvid,aid:Number(detail.aid)||0,cid,page:pageNumber,pages:parts,title,partTitle:validTitle(cleanTitle(part?.part))?cleanTitle(part.part):'',duration:(Number(data?.timelength)||0)/1000,data}:undefined;
    captionStatus='unavailable';
    // Subtitle discovery is performed by the background using the player's
    // binary metadata endpoint, never the unsigned legacy JSON caption list.
    const currentUrl=new URL(location.href),currentBvid=currentUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || currentUrl.searchParams.get('bvid') || '',currentPage=Math.max(1,Number(currentUrl.searchParams.get('p'))||1);
    if(currentBvid!==String(bvid||'') || currentPage!==pageNumber){
      tracks.length=0;registry.tracks.set(video,[]);platform=undefined;captionStatus='unavailable';
    }else if(identity.valid){
      registry.bilibiliIdentity={bvid,cid,page:pageNumber,videoData:detail,duration:Number(data?.timelength||0)/1000 || Number(part?.duration) || (detail.pages?.length===1?Number(detail.duration):0) || (Number.isFinite(video.duration)?video.duration:0)};
    }
  }
  if(!videos.length&&platform?.site==='twitch')candidates.push({title,url:location.href,downloadUrl:location.href,referer:location.href,mediaKey:'twitch-vod:'+platform.id,mediaIdentity:platform.id});
  return {url:location.href,title,tracks,platform,captionStatus,captionInventory:Array.isArray(renderer?.captionTracks),videos:candidates,mediaIndex,language:document.documentElement.lang,preferredLanguages:navigator.languages,media:video?{url:source(video),mediaKey:identities.keys.get(video),discoveryReason:candidates[mediaIndex]?.discoveryReason,drm:!!video.mediaKeys,time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null}:null};
}
export async function pageSubtitles(language,openTranscript=false,mediaIndex=0,automatic=false,selector={}){
  try{
  // This function is also passed directly to executeScript and must be
  // self-contained.
  const norm=s=>String(s || '').replace(/-orig$/,'').replace(/_/g,'-').toLowerCase();
  const captionParameters=raw=>{try{const u=new URL(raw),encoded=u.pathname.match(/\/tts_params\/([^/]+)/)?.[1];return encoded?new URLSearchParams(decodeURIComponent(encoded)):u.searchParams;}catch{return new URLSearchParams();}};
  const fetchText=async url=>{
    const youtube=selector.pageSource==='youtube-page',controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('字幕讀取逾時','TimeoutError')),youtube?6000:10000);
    try{
      const res=await fetch(url,{credentials:new URL(url,location.href).origin===location.origin?'include':'omit',signal:controller.signal});
      if(!res.ok)throw Object.assign(new Error(youtube?'YT_FILE_HTTP':`字幕讀取失敗（HTTP ${res.status}）`),{code:youtube?'YT_FILE_HTTP':undefined,status:res.status});
      const raw=await res.text();if(!raw.trim())throw Object.assign(new Error(youtube?'YT_FILE_EMPTY':'字幕為空'),{code:youtube?'YT_FILE_EMPTY':undefined});
      if(selector.videoId){const current=new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];if(current!==selector.videoId)throw Object.assign(new Error('SOURCE_CHANGED'),{code:'SOURCE_CHANGED'});}
      return raw;
    }catch(error){if(youtube&&!error?.code)throw Object.assign(new Error(error?.name==='AbortError'||error?.name==='TimeoutError'?'YT_TIMEOUT':'YT_FILE_NETWORK'),{code:error?.name==='AbortError'||error?.name==='TimeoutError'?'YT_TIMEOUT':'YT_FILE_NETWORK'});throw error;}
    finally{clearTimeout(timer);}
  };
  const biliPage=/(^|\.)bilibili\.com$/.test(String(location.hostname).toLowerCase());
  const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const currentPlayer=document.querySelector('#movie_player');
  const animePage=/(^|\.)ani\.gamer\.com\.tw$/.test(String(location.hostname).toLowerCase());
  const animeMain=v=>animePage&&v?.getAttribute?.('id')==='ani_video_html5_api';
  const videos=roots.flatMap(root=>[...root.querySelectorAll('video')]).sort((a,b)=>Number(animeMain(b))-Number(animeMain(a)) || Number(!!currentPlayer?.contains(b))-Number(!!currentPlayer?.contains(a)));
  const video=selector.mediaKey?videos.find(v=>window[Symbol.for('video-pocket.identities')]?.keys?.get(v)===selector.mediaKey):videos[Number(mediaIndex)||0];
  // Bilibili's currentSrc changes during ordinary CDN/quality refreshes, and
  // SPA player replacement can produce a new <video> node for the same CID.
  // Its captions are keyed by BVID/CID, so media URL and WeakMap identity are
  // not valid video-change signals there.
  if(!biliPage&&selector.mediaKey&&window[Symbol.for('video-pocket.identities')]?.keys?.get(video)!==selector.mediaKey)throw new Error('影片已變更，請更新影片資訊');
  if(!biliPage&&selector.mediaUrl&&(!video||(video.currentSrc || video.src || video.querySelector('source')?.src || '')!==selector.mediaUrl))throw new Error('影片已變更，請更新影片資訊');
  const registry=window[Symbol.for('video-pocket.selection')];
  const known=biliPage
    ? [...(registry?.tracks?.values?.() || [])].flat().find(t=>t.pageTrackId===selector.pageTrackId&&t.source==='bilibili-api'&&(!selector.expectedBvid||t.bvid===selector.expectedBvid)&&(!selector.expectedCid||Number(t.cid)===Number(selector.expectedCid))&&(!selector.expectedPage||Number(t.page)===Number(selector.expectedPage)))
    : registry?.tracks?.get(video)?.find(t=>t.pageTrackId===selector.pageTrackId&&(t.source==='bilibili-api'||t.pageTrackIndex===selector.pageTrackIndex));
  if(biliPage)throw Object.assign(new Error('BILI_SOURCE_REJECTED'),{code:'BILI_SOURCE_REJECTED'});
  if(known?.url&&selector.pageSource!=='youtube-page'&&(!language||norm(known.language)===norm(language))){try{return {raw:await fetchText(known.url),language:known.language,source:'網頁字幕檔',automatic:false};}catch{}}
  const htmlCandidates=video?[...video.textTracks].filter(t=>['subtitles','captions'].includes(t.kind)&&(!language||norm(t.language)===norm(language))):[];
  const indexed=video?.textTracks[selector.pageTrackIndex];
  const htmlTrack=selector.pageSource==='youtube-page'?null:selector.pageTrackId?selector.pageTrackId===`html:${selector.pageTrackIndex}`&&htmlCandidates.includes(indexed)?indexed:null:htmlCandidates.length===1?htmlCandidates[0]:null;
  if(htmlTrack){
    const element=[...video.querySelectorAll('track')].find(t=>t.track===htmlTrack);
    if(element?.src){try{return {raw:await fetchText(element.src),language:htmlTrack.language || 'und',source:'網頁字幕檔',automatic:false};}catch{}}
    if(htmlTrack.cues?.length)return {cues:[...htmlTrack.cues].map(c=>({start:c.startTime,end:c.endTime,text:c.text})),language:htmlTrack.language || 'und',source:'已載入字幕',partial:true,automatic:false};
  }
  const player=document.querySelector('#movie_player');let response,active;
  try{response=player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;active=player?.getOption?.('captions','track');}catch{}
  const id=new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];if(id&&response?.videoDetails?.videoId!==id)response=null;
  if(selector.videoId&&response?.videoDetails?.videoId!==selector.videoId)throw new Error('影片已變更，請更新影片資訊');
  if(video&&player?.querySelector('video')&&!player.contains(video))response=null;
  const captions=response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const original=captions.filter(t=>{const p=captionParameters(t.baseUrl);return !p.get('tlang')||norm(p.get('tlang'))===norm(p.get('lang'));});
  const matches=original.filter(t=>(!language||norm(t.languageCode)===norm(language))&&(t.kind==='asr')===!!automatic);
  const exactMatches=selector.pageTrackId?matches.filter(t=>(t.vssId || `youtube:${captions.indexOf(t)}`)===selector.pageTrackId):matches;
  const selected=exactMatches.length===1?exactMatches[0]:null;
  let captionReadFailure;
  if(selected?.baseUrl&&selector.captionUrl){try{
    const u=new URL(selector.captionUrl),p=u.searchParams,baseName=captionParameters(selected.baseUrl).get('name') || '';
    if(u.protocol==='https:'&&/(^|\.)youtube\.com$/.test(u.hostname)&&u.pathname==='/api/timedtext'&&p.get('v')===response.videoDetails.videoId&&norm(p.get('lang'))===norm(selected.languageCode)&&!p.has('tlang')&&(p.get('kind')==='asr')===(selected.kind==='asr')&&(p.get('name') || '')===baseName)return {raw:await fetchText(u.href),language:selected.languageCode,automatic:selected.kind==='asr',source:'播放器字幕檔'};
  }catch(error){if(error?.code==='SOURCE_CHANGED'||error?.message==='影片已變更，請更新影片資訊')throw error;}}
  if(selected?.baseUrl){try{const url=new URL(selected.baseUrl),params=captionParameters(url.href);if(url.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(url.hostname)||url.pathname!=='/api/timedtext'||params.get('v')!==response.videoDetails.videoId||norm(params.get('lang'))!==norm(selected.languageCode)||params.has('tlang')||(params.get('kind')==='asr')!==(selected.kind==='asr')||(params.get('name')||'')!==(selected.captionName||selector.captionName||captionParameters(selected.baseUrl).get('name')||''))throw Object.assign(new Error('YT_SOURCE_UNAVAILABLE'),{code:'YT_SOURCE_UNAVAILABLE'});url.searchParams.set('fmt','json3');return {raw:await fetchText(url.href),language:selected.languageCode,automatic:selected.kind==='asr',source:'播放器字幕檔'};}catch(error){if(error?.code==='SOURCE_CHANGED'||error?.message==='影片已變更，請更新影片資訊')throw error;captionReadFailure=error;}}
  const nameLanguage=label=>{
    const s=String(label || '').toLowerCase();for(const [re,code] of [[/中文|chinese/,'zh'],[/english|英語|英文/,'en'],[/japanese|日本語|日語|日文/,'ja'],[/korean|한국|韓語|韓文/,'ko'],[/french|français|法語|法文/,'fr'],[/german|deutsch|德語|德文/,'de'],[/spanish|español|西班牙/,'es']])if(re.test(s))return code;return '';
  };
  const readPayload=()=>{
    const cached=window[Symbol.for('video-pocket.transcript')];
    if(!selected||original.length!==1||cached?.videoId!==response.videoDetails.videoId)return null;
    // hl is the interface language, not a caption-track selector. A panel
    // response is safe only when the video has exactly one original track.
    if(cached.trackId!==(selected.vssId || `youtube:${selector.pageTrackIndex}`))return null;
    const cues=[];let continuation=false;
    const text=v=>typeof v==='string'?v:v?.simpleText || v?.runs?.map(r=>r.text).join('') || v?.content || '';
    const scan=v=>{if(!v||typeof v!=='object')return;for(const [key,item] of Object.entries(v)){
      if(key==='continuationItemRenderer')continuation=true;
      if(key==='transcriptSegmentViewModel'&&item.timestamp)cues.push({start:String(item.timestamp).split(':').reduce((n,s)=>n*60+Number(s),0),text:text(item.simpleText)});
      else if(key==='transcriptSegmentRenderer')cues.push({start:Number(item.startMs)/1000,end:Number(item.endMs)/1000,text:text(item.snippet)});
      else scan(item);
    }};scan(cached.data.content || cached.data);
    if(!cues.length||continuation)return null;
    cues.sort((a,b)=>a.start-b.start);const duration=Number(response.videoDetails.lengthSeconds);
    for(let i=0;i<cues.length;i++)if(!Number.isFinite(cues[i].end))cues[i].end=cues[i+1]?.start || Math.max(cues[i].start,duration || cues[i].start+4);
    return {cues,language:selected.languageCode,automatic:selected.kind==='asr',source:'完整官方逐字稿',approximateEnds:true};
  };
  if(selected&&original.length===1&&matches.length===1&&(selected.kind!=='asr'||!original.some(t=>norm(t.languageCode)===norm(selected.languageCode)&&t.kind!=='asr'))&&/^[\w-]{11}$/.test(response.videoDetails.videoId)){
    try{
      const context=structuredClone(window.ytcfg?.get?.('INNERTUBE_CONTEXT'));if(context?.client){
        context.client.hl=selected.languageCode;
        // Public get_panel protobuf: field 149 contains video ID and panel mode.
        const params=btoa(String.fromCharCode(0xaa,0x09,0x0f,0x0a,0x0b)+response.videoDetails.videoId+String.fromCharCode(0x18,0x01));
        const res=await fetch('/youtubei/v1/get_panel?prettyPrint=false',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({context,panelId:'PAmodern_transcript_view',params}),signal:AbortSignal.timeout(10000)});
        if(res.ok){const data=await res.json(),currentId=new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];if(currentId!==response.videoDetails.videoId||player.getPlayerResponse?.()?.videoDetails?.videoId!==response.videoDetails.videoId)throw new Error('影片已變更，請更新影片資訊');if(!data.error){window[Symbol.for('video-pocket.transcript')]={videoId:response.videoDetails.videoId,trackId:selected.vssId || `youtube:${selector.pageTrackIndex}`,data};const result=readPayload();if(result)return result;}}
      }
    }catch(error){if(error?.code==='SOURCE_CHANGED'||error?.message==='影片已變更，請更新影片資訊')throw error;}
  }
  const readDom=()=>{
    if(!selected||original.length!==1)return [];
    if(selector.videoId){const currentId=new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];if(currentId!==selector.videoId)throw new Error('影片已變更，請更新影片資訊');}
    const label=document.querySelector('ytd-transcript-footer-renderer #label')?.textContent?.trim() || '';
    const name=t=>typeof t?.name==='string'?t.name:t?.name?.simpleText || t?.name?.runs?.map(r=>r.text).join('') || '';
    // A language-only footer cannot identify one of several Japanese variants.
    // Require its complete author label, or refuse this fallback.
    if(matches.length>1&&label!==name(selected))return [];
    if(/auto.translat|自動翻譯|自动翻译/i.test(label))return [];
    if(/auto.generated|自動產生|自动生成/i.test(label)&&selected.kind!=='asr')return [];
    const footerLang=nameLanguage(label),expected=norm(selected.languageCode).split('-')[0];
    const renderer=response.captions.playerCaptionsTracklistRenderer,defaultIndex=renderer.defaultCaptionTrackIndex ?? renderer.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0]?.defaultCaptionTrackIndex ?? 0;
    if(footerLang ? footerLang!==expected : label?(!active||active.translationLanguage||norm(active.languageCode).split('-')[0]!==expected):captions[defaultIndex]!==selected)return [];
    const parse=s=>String(s).trim().split(':').reduce((n,v)=>n*60+Number(v),0);
    const nodes=[...document.querySelectorAll('ytd-transcript-segment-renderer,transcript-segment-view-model')];
    const stamp=n=>n?.querySelector('.segment-timestamp,.ytwTranscriptSegmentViewModelTimestamp')?.textContent;
    return nodes.map((n,i)=>{const start=parse(stamp(n) || '');const next=stamp(nodes[i+1]);return {start,end:next?parse(next):start+4,text:n.querySelector('.segment-text,span[role="text"]')?.textContent?.trim() || ''};}).filter(c=>Number.isFinite(c.start)&&c.text);
  };
  const domResult=cues=>({cues,language:selected.languageCode,automatic:selected.kind==='asr',source:'頁面逐字稿',approximateEnds:true,partial:true});
  const payload=readPayload();if(payload)return payload;
  let cues=readDom();if(cues.length)return domResult(cues);
  if(selected)throw captionReadFailure || Object.assign(new Error('YT_SOURCE_UNAVAILABLE'),{code:'YT_SOURCE_UNAVAILABLE'});
  throw new Error('SUBTITLE_UNAVAILABLE');
  }catch(error){return {error:error.message || '字幕讀取失敗',errorCode:error?.code || (/^SUBTITLE_/.test(error.message)?error.message:undefined),errorStatus:error?.status,errorApiCode:error?.apiCode,subtitleStage:error?.subtitleStage,retryable:error?.retryable===true};}
}



