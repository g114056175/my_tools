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

export async function pageSnapshot(mediaIndex=0, discoveryMode='deep', budgetConfig={}){
  const earlyPlatform=discoveryMode==='focused'&&budgetConfig.earlyPlatform?.binding==='generic-early'?budgetConfig.earlyPlatform:null;
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
  // Use the same observer inventory in both phases so an index keeps referring
  // to the same element. No synchronous all-element shadow walk on popup open.
  const roots=[document];
  const player=document.querySelector('#movie_player');
  const animePage=/(^|\.)ani\.gamer\.com\.tw$/.test(String(location.hostname).toLowerCase());
  const animeMain=v=>animePage&&v?.getAttribute?.('id')==='ani_video_html5_api';
  const dailymotionPage=/(^|\.)dailymotion\.com$/.test(String(location.hostname).toLowerCase());
  const socialPage=/(^|\.)\b(?:x|twitter|reddit|tiktok|instagram|facebook|threads)\.(?:com|net)$/.test(String(location.hostname).toLowerCase()) || /(^|\.)twitch\.tv$/i.test(location.hostname)&&/\/clips\/?$/i.test(location.pathname);
  const dailymotionMain=v=>dailymotionPage&&v?.getAttribute?.('id')==='video';
  const bilibiliPage=/(^|\.)bilibili\.com$/.test(String(location.hostname).toLowerCase());
  const biliUrl=new URL(location.href),biliBvid=bilibiliPage?(biliUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || biliUrl.searchParams.get('bvid') || ''):'';
  const biliIdentity=biliBvid?`bilibili:${biliBvid}:${Math.max(1,Number(biliUrl.searchParams.get('p'))||1)}`:'';
  const sourceObserver=window[Symbol.for('video-pocket.mediaObserver')];
  const deepDiscovery=discoveryMode!=='summary';
  const clock=()=>typeof performance?.now==='function'?performance.now():Date.now();
  const deepStarted=clock(),deepMaxMs=Math.max(50,Math.min(30000,Number(budgetConfig.maxMs)||1800)),deepMaxItems=Math.max(1,Math.min(64,Number(budgetConfig.maxItems)||24));let deepCount=0,deepReason=earlyPlatform?'player-first':'complete';
  const deepTake=()=>{if(deepCount>=deepMaxItems||clock()-deepStarted>=deepMaxMs){deepReason=deepCount>=deepMaxItems?'item-budget':'time-budget';return false;}deepCount++;return true;};
  const registered=sourceObserver?.videosSnapshot?.(256) || [];
  const isPresent=sourceObserver?.isPresent || window[Symbol.for('video-pocket.sourceEvidence')]?.isMediaPresent;
  const rawVideos=[...new Set([...registered,...roots.flatMap(root=>[...root.querySelectorAll('video')].slice(0,256))])].filter(video=>video?.isConnected!==false&&(!video.ownerDocument||video.ownerDocument===document)&&(!isPresent||isPresent(video)!==false)).slice(0,256),availableVideos=new Set(rawVideos);
  // Known players can retain an empty fallback <video> beside the real MSE
  // element. Collapse only an observer-verified, same-player replacement.
  const videos=[...new Set(rawVideos.map(video=>{try{const active=sourceObserver?.canonicalVideo?.(video);return availableVideos.has(active)?active:video;}catch{return video;}}))];
  const biliOwned=v=>{let node=v;for(let depth=0;node&&depth<16;depth++){try{if(node.closest?.('#bilibili-player,#bilibiliPlayer,.bpx-player-container,.bilibili-player-video,bwp-video'))return true;const host=node.getRootNode?.()?.host;if(!host||host===node)break;node=host;}catch{break;}}return false;};
  const biliPlayers=new Set(biliIdentity?videos.filter(biliOwned):[]);
  // A floating player may reuse the element or mirror its exact current source.
  // Bind only owned Bilibili players, never every video on a watch page.
  const biliSources=new Set([...biliPlayers].map(v=>v.currentSrc || v.src).filter(Boolean));
  if(biliIdentity)for(const v of videos)if(biliSources.has(v.currentSrc || v.src))biliPlayers.add(v);
  if(biliIdentity&&!biliPlayers.size&&videos.length===1)biliPlayers.add(videos[0]);
  const biliRank=v=>{
    if(!biliPlayers.has(v))return 0;
    try{const r=v.getBoundingClientRect(),style=globalThis.getComputedStyle?.(v);return 1+4*Number(r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<(globalThis.innerHeight||100000)&&r.left<(globalThis.innerWidth||100000)&&style?.display!=='none'&&style?.visibility!=='hidden')+2*Number(v.paused===false)+Number(v.readyState>1);}catch{return 1;}
  };
  videos.sort((a,b)=>Number(animeMain(b))-Number(animeMain(a)) || Number(dailymotionMain(b))-Number(dailymotionMain(a)) || biliRank(b)-biliRank(a) || Number(!!player?.contains(b))-Number(!!player?.contains(a)));
  // Keep the inventory order stable: the background and picker use its
  // indices as identity slots. Compute an independent default preference for
  // social pages so an in-view player belonging to the current post wins over
  // an earlier comment/ad player without moving any slot.
  const preferredMediaIndex=(()=>{
    if(videos.length<=1)return videos.length?0:-1;
    const knownMain=videos.findIndex(v=>animeMain(v)||dailymotionMain(v)||biliPlayers.has(v)||player?.contains(v));
    if(knownMain>=0)return knownMain;
    let pageUrl;try{pageUrl=new URL(location.href);}catch{return 0;}
    const host=/^(?:www\.)?(?:x|twitter)\.com$/i.test(pageUrl.hostname)?pageUrl.hostname:'';
    const route=host?(pageUrl.pathname.match(/^\/[^/]+\/status\/(\d+)/i)?.[1]||pageUrl.pathname.match(/^\/i\/broadcasts\/([A-Za-z0-9_-]+)/i)?.[1]||''):'';
    const hrefOf=node=>{try{return node?.href||node?.getAttribute?.('href')||'';}catch{return '';}};
    const belongsToRoute=video=>{
      if(!route)return 0;
      for(let node=video,depth=0;node&&depth<24;depth++,node=node.parentElement||node.getRootNode?.()?.host){
        if(depth>0&&/^(?:BODY|HTML|MAIN)$/i.test(node.tagName||''))break;
        let links=[];try{links=[...(node.querySelectorAll?.('a[href]')||[])];}catch{}
        for(const link of links){let url;try{url=new URL(hrefOf(link),location.href);}catch{continue;}
          if(url.origin!==pageUrl.origin)continue;
          const id=url.pathname.match(/^\/[^/]+\/status\/(\d+)/i)?.[1]||url.pathname.match(/^\/i\/broadcasts\/([A-Za-z0-9_-]+)/i)?.[1]||'';
          if(id&&id===route)return 1;
        }
        if(depth>0&&(/^(?:ARTICLE)$/i.test(node.tagName||'')||String(node.getAttribute?.('role')||'').toLowerCase()==='article'))break;
      }
      return 0;
    };
    const viewportScore=video=>{
      try{const rect=video.getBoundingClientRect?.();if(!rect)return 0;const left=Math.max(0,Math.min(innerWidth,rect.right)-Math.max(0,rect.left)),top=Math.max(0,Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top)),area=Math.max(0,left)*Math.max(0,top);return area>0?Math.min(1,area/Math.max(1,Math.abs(rect.width*rect.height))):0;}catch{return 0;}
    };
    const score=(video,index)=>{
      const source=String(video?.currentSrc||video?.src||video?.getAttribute?.('src')||'');
      const label=String(video?.title||video?.getAttribute?.('aria-label')||'');
      const gif=/\.gif(?:[?#]|$)|\bgif\b/i.test(`${source} ${label}`);
      return belongsToRoute(video)*1000+viewportScore(video)*100+Number(video?.paused===false)*12+Number(Number(video?.readyState)>1)*4-Number(gif)*8-index/1000;
    };
    let best=0,bestScore=score(videos[0],0);for(let i=1;i<videos.length;i++){const value=score(videos[i],i);if(value>bestScore){best=i;bestScore=value;}}
    return best;
  })();
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
  const biliDetail=window.__INITIAL_STATE__?.videoData;
  const biliTitle=bilibiliPage&&String(biliDetail?.bvid || '')===biliBvid?String(biliDetail?.title || '').trim():'';
  if(biliTitle)title=biliTitle;
  const animeTitle=animePage?String(document.title || '').replace(/\s*線上看\s*-\s*巴哈姆特動畫瘋\s*$/,'').trim():'';
  // Titles are resolved independently from source discovery. A weaker DOM
  // label must never replace a title already bound by a player/API model.
  const named=value=>{
    const text=String(value || '').replace(/\s+/g,' ').trim();if(!text)return '';
    try{if(sourceObserver?.isGenericTitle?.(text))return '';}catch{}
    return /^(?:(?:youtube|twitch|facebook|instagram|tiktok|twitter|bilibili|x)\s*[-:：|·]?\s*)?(?:(?:html5|embedded|嵌入式?|嵌入)\s*)?(?:video|media|影片|视频|視頻)\s*(?:player|播放器)?\s*\d*$/i.test(text)||/^(?:youtube|twitch|facebook|instagram|tiktok|twitter|bilibili|播放器|播放影片|播放视频|播放視頻)$/i.test(text)?'':text;
  };
  const resolveTitle=(v,i,knownTitle='')=>{
    const known=named(knownTitle);if(known)return known;
    let owned='';try{owned=named(sourceObserver?.titleFor?.(v,{includeAria:false}));}catch{}if(owned)return owned;
    const local=[v.title,v.getAttribute?.('data-video-title'),v.getAttribute?.('data-mwtitle'),v.closest?.('figure')?.querySelector?.('figcaption')?.textContent].map(named).find(Boolean);
    if(local)return local;
    if(videos.length===1||player?.contains(v)||biliPlayers.has(v)||animeMain(v)||dailymotionMain(v)){
      const heading=player?.contains(v)?document.querySelector('h1.ytd-watch-metadata,ytd-watch-metadata h1,#title h1')?.textContent:null;
      if(named(heading))return named(heading);
      if(!socialPage){try{for(const node of document.querySelectorAll('meta[property="og:title"],meta[name="twitter:title"],meta[name="title"]')){const value=named(node.content || node.getAttribute?.('content'));if(value)return value;}}catch{}
      if(named(document.title))return named(document.title);}
    }
    let label='';try{label=named(sourceObserver?.titleFor?.(v));}catch{}
    label ||= named(v.getAttribute?.('aria-label'));if(label)return label;
    try{
      const raw=v.currentSrc || v.getAttribute?.('src') || v.src || v.querySelector?.('source')?.src;
      const sourceUrl=raw?new URL(raw,location.href):null;
      if(sourceUrl&&/^https?:$/.test(sourceUrl.protocol)){
        const basename=decodeURIComponent(sourceUrl.pathname.split('/').pop() || '');
        const filename=basename.replace(/\.(?:mp4|webm|mkv|mov|m4v|ogv|avi)$/i,'').replace(/[_-]+/g,' ').trim();
        if(filename!==basename&&named(filename)&&!/^\d+$/.test(filename)&&!/[a-f\d]{24}/i.test(filename))return filename;
      }
    }catch{}
    return `Video ${i+1}`;
  };
  const mainTitle=v=>animeMain(v)?animeTitle:player?.contains(v)?mainResponse?.videoDetails?.title:biliPlayers.has(v)?biliTitle:'';
  const candidates=videos.map((v,i)=>({title:resolveTitle(v,i,mainTitle(v)),url:v.currentSrc || v.src,referer:location.href}));
  // Popup opening needs a cheap inventory only.  Do not parse document JSON,
  // inspect player registries, or bind ambient sources for unselected videos.
  if(!deepDiscovery){
    const identities=window[Symbol.for('video-pocket.identities')] ||= {keys:new WeakMap(),next:0};
    for(const [i,v] of videos.entries()){
      if(!identities.keys.has(v))identities.keys.set(v,++identities.next);
      const candidate=candidates[i], raw=candidate.url || '';
      candidate.mediaKey=identities.keys.get(v);candidate.url=raw;candidate.downloadUrl=null;
      try{const evidence=window[Symbol.for('video-pocket.sourceEvidence')]?.collectMediaEvidence?.({video:v,root:document,pageUrl:location.href}),identity=evidence?.identity;candidate.selectionIdentity=identity?.key || '';candidate.mediaIdentity=identity?.key || '';candidate.mediaContentId=identity?.id || '';candidate.recoveryIdentity=evidence?.identityBound===true;}catch{}
      if(dailymotionMain(v))candidate.dailymotionMain=true;
      if(biliPlayers.has(v))Object.assign(candidate,{bilibiliMain:true,bilibiliRank:biliRank(v),selectionIdentity:biliIdentity,mediaIdentity:biliIdentity,mediaContentId:biliIdentity,title,downloadUrl:location.href});
    }
    let dmContext;try{dmContext=sourceObserver?.pageContext?.() || undefined;}catch{}
    const summaryPage=Math.max(1,Number(biliUrl.searchParams.get('p'))||1),detail=window.__INITIAL_STATE__?.videoData || {},part=detail.pages?.[summaryPage-1],summaryBili=biliBvid?{site:'bilibili',bvid:biliBvid,page:summaryPage,cid:Number(part?.cid || (summaryPage===1?detail.cid:0))||0,title:String(detail.title || title || ''),duration:Number(part?.duration || detail.duration || 0)}:undefined;
    return {url:location.href,title, discoveryMode:'summary', dailymotionContext:dmContext, bilibiliContext:summaryBili, videos:candidates, mediaIndex:Math.max(0,Math.min(Number(mediaIndex)||0,candidates.length-1)), preferredMediaIndex, tracks:[], preferredLanguages:[...(navigator.languages||[])], language:document.documentElement?.lang||''};
  }
  const elementSource=node=>{const raw=node?.getAttribute?.('src');return typeof raw==='string'&&!raw.trim()?'':node?.src || raw || '';};
  const source=v=>v.currentSrc || elementSource(v) || [...v.querySelectorAll('source')].map(elementSource).find(Boolean) || '';
  const http=raw=>{try{const u=new URL(raw,location.href);return /^https?:$/.test(u.protocol)&&raw?u.href:null;}catch{return null;}};
  const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/\.(mpd|m3u8)(?:\?|$)/i.test(u));
  let platform=earlyPlatform || undefined,captionStatus,dailymotionContext,bilibiliContext;
  const snapshotModels=new WeakMap();let embeddedModel;
  const observedModel=v=>{if(earlyPlatform||!v||v!==video)return null;if(!snapshotModels.has(v)){let model=null;try{model=sourceObserver?.modelFor?.(v,{drain:false}) || null;}catch{}snapshotModels.set(v,model);}return snapshotModels.get(v);};
  try{
    if(!earlyPlatform){if(deepTake()){const pending=sourceObserver?.drainMetadata?.(16,deepTake,video);if(pending?.queued&&deepReason==='complete')deepReason='metadata-budget';}else deepReason='metadata-budget';
    let scripts=0;
    if(deepTake())sourceObserver?.scanDocument?.(videos,()=>scripts++<8&&deepTake(),video);else deepReason='document-budget';
    embeddedModel=observedModel(video);
    if(embeddedModel){
      platform={...embeddedModel,site:'embedded'};
      // Keep the complete bound model's quality list. A live ABR rendition
      // may be only 360p even when its master includes 1080p. Retain that
      // exact player's manifest as a backup for expired model URLs.
      const active=(deepTake()?sourceObserver?.sourcesFor?.(video):{candidates:[]}).candidates.filter(c=>c.downloadable!==false&&c.evidence?.some(e=>/^(?:mse-|blob-http-body|video\.(?:currentSrc|src)|source-element)/.test(e)));
      if(active.length===1&&http(active[0].url)){
        const current=active[0];
        if(current.kind==='progressive')platform.versions=[{url:current.url,width:Number(video.videoWidth)||0,height:Number(video.videoHeight)||0},...(platform.versions || []).filter(v=>v.url!==current.url)];
        else if(current.kind==='hls'||current.kind==='dash'){
          if(platform.manifestUrl||platform.manifestXml){if(current.url!==platform.manifestUrl)platform.playbackManifest={url:current.url,type:current.kind};}
          else{platform.manifestUrl=current.url;platform.manifestType=current.kind;}
        }
      }
    }}
  }catch{}
  try{
    dailymotionContext=sourceObserver?.pageContext?.() || undefined;
    if(dailymotionMain(video)&&dailymotionContext?.id){platform={...dailymotionContext,site:'dailymotion'};title=dailymotionContext.title || title;}
  }catch{}
  const currentUrl=new URL(location.href),igHost=/(^|\.)instagram\.com$/i.test(currentUrl.hostname),igCode=currentUrl.pathname.match(/^\/(?:reel|p|tv)\/([^/?#]+)/i)?.[1];
  if(!platform&&video&&videos.length===1&&igHost&&igCode){
    const embedded=instagramEmbedded(igCode),best=embedded?.versions?.[0];
    if(best?.url){candidates[0].adapterDownloadUrl=best.url;candidates[0].title=title;}
    if(embedded)platform={site:'instagram',id:igCode,shortcode:igCode,title,duration:embedded.duration,width:embedded.width,height:embedded.height,versions:embedded.versions.map(v=>({url:v.url,width:v.width||embedded.width,height:v.height||embedded.height,id:v.id})),manifestXml:embedded.dash || undefined};
  }
  const twitchHost=/(^|\.)twitch\.tv$/i.test(currentUrl.hostname),twitchId=currentUrl.pathname.match(/^\/videos\/(\d+)/i)?.[1];
  let twitchPlayers=[];const twitchMetadata=new WeakMap();
  if(twitchHost&&video)try{const metadata=sourceObserver?.twitchPlayerFor?.(video,videos);if(metadata)twitchMetadata.set(video,metadata);}catch{}
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
  const twitchSelected=twitchMetadata.get(video);
  if(twitchSelected?.kind==='clip'&&twitchSelected.slug)platform={...twitchSelected,site:'twitch-clip'};
  else if(twitchSelected?.kind==='vod'&&/^\d+$/.test(twitchSelected.id))platform={site:'twitch',id:twitchSelected.id,title:twitchSelected.title || candidates[mediaIndex]?.title || title,duration:twitchSelected.duration || (Number.isFinite(video?.duration)?video.duration:0)};
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
    for(const [i,getter] of direct.entries()){const value=readHttp(getter);if(value)return {url:value,active:i<7};}
    // These are normal Video.js runtime APIs and are deliberately read-only;
    // they are fallback signals after the active VHS source fields above.
    for(const getter of [()=>instance?.currentSource?.()?.src,()=>instance?.currentSrc?.(),()=>instance?.currentSources?.()?.map(s=>s?.src).find(src=>http(src))]){const value=readHttp(getter);if(value)return {url:value,active:false};}
    return null;
  };
  const identities=window[Symbol.for('video-pocket.identities')] ||= {keys:new WeakMap(),next:0};
  for(const [i,v] of videos.entries()){
    if(!identities.keys.has(v))identities.keys.set(v,++identities.next);
    const candidate=candidates[i];candidate.mediaKey=identities.keys.get(v);candidate.url=source(v);candidate.downloadUrl=candidate.adapterDownloadUrl || null;delete candidate.adapterDownloadUrl;
    // Keep element-owned alternatives separate from ambient network records.
    // Background can verify these even when this frame has several players.
    let observedSources;try{candidate.sourceCandidates=[];if(!earlyPlatform&&i===mediaIndex&&deepTake()){observedSources=sourceObserver?.sourcesFor?.(v);candidate.sourceCandidates=(observedSources?.candidates || []).filter(item=>item.downloadable!==false&&http(item.url)&&['hls','dash','progressive'].includes(item.kind)).slice(0,12).map(item=>({url:http(item.url),kind:item.kind,evidence:(item.evidence || []).filter(value=>typeof value==='string').slice(0,8),...(item.sourceGroup?{sourceGroup:item.sourceGroup}:{})}));}}catch{}
    if(dailymotionMain(v))candidate.dailymotionMain=true;
    let modelTitle='';try{modelTitle=named(observedModel(v)?.title);}catch{}
    candidate.title=resolveTitle(v,i,mainTitle(v)||modelTitle||(i===mediaIndex?earlyPlatform?.title:'')||(dailymotionMain(v)?dailymotionContext?.title:''));
    try{
      const evidence=window[Symbol.for('video-pocket.sourceEvidence')]?.collectMediaEvidence?.({video:v,root:document,pageUrl:location.href}),identity=evidence?.identity;
      candidate.selectionIdentity=identity?.key || '';
      candidate.mediaIdentity=observedModel(v)?.id || identity?.key || '';
      candidate.mediaContentId=identity?.id || observedModel(v)?.id || '';
      candidate.recoveryIdentity=evidence?.identityBound===true||!!observedModel(v)?.id;
      // A feed may have already discarded its playback JSON. Only the exact
      // one-player permalink is eligible for a bounded document lookup.
      if(identity?.id&&identity.anchor){const link=new URL(identity.anchor);if(link.protocol==='https:'&&link.origin===location.origin)candidate.linkedMedia={url:link.href,id:identity.id};}
    }catch{}
    if(twitchId&&twitchPlayers.includes(v))candidate.mediaIdentity='twitch-vod:'+twitchId;
    const twitchOwned=twitchMetadata.get(v);if(twitchOwned){const contentId=twitchOwned.kind==='clip'?twitchOwned.slug:twitchOwned.id;candidate.mediaIdentity=`twitch-${twitchOwned.kind}:${contentId}`;candidate.mediaContentId=candidate.mediaIdentity;if(twitchOwned.title)candidate.title=twitchOwned.title;}
    if(biliPlayers.has(v))Object.assign(candidate,{bilibiliMain:true,bilibiliRank:biliRank(v),selectionIdentity:biliIdentity,mediaIdentity:biliIdentity,mediaContentId:biliIdentity,title,downloadUrl:location.href});
    if(player?.contains(v)&&response?.videoDetails?.videoId)candidate.downloadUrl=location.href;
    if(i!==mediaIndex){candidate.downloadUrl ||= http(source(v));continue;}
    if(!candidate.downloadUrl){
      for(const instance of videojsPlayers)try{
        if(!playerOwnership(instance,v))continue;
        const current=readVideoJsSource(instance);candidate.downloadUrl=http(current?.url);
        if(current?.active&&candidate.downloadUrl)candidate.activePlayerSource=candidate.downloadUrl;
        if(candidate.downloadUrl)break;
      }catch{}
      if(!candidate.downloadUrl)for(const instance of [...instances,v.hls])try{if(instance&&(instance.media===v || instance.getVideoElement?.()===v)){candidate.downloadUrl=http(instance.url || instance.getSource?.());if(candidate.downloadUrl)break;}}catch{}
      // A stale welcome/ad <source> must not preempt the active VHS playlist.
      candidate.downloadUrl ||= http(source(v)) || http(elementSource(v)) || [...v.querySelectorAll('source')].map(s=>http(elementSource(s))).find(Boolean) || null;
      candidate.downloadUrl ||= ['data-hls-url','data-dash-url','data-src'].map(key=>http(v.getAttribute(key))).find(Boolean) || null;
      if(!candidate.downloadUrl)try{candidate.discoveryReason=observedSources?.reason || '';const sources=observedSources?.candidates?.filter(item=>item.downloadable!==false) || [];if(sources.length===1){candidate.downloadUrl=http(sources[0].url);candidate.sourceType=sources[0].kind;}else if(sources.length>1)candidate.discoveryReason='ambiguous-source';}catch{}
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
      return [{language:t.language || 'und',name:t.label&&t.label!=='null'?t.label:t.language || 'Subtitles',url:element?.src || (matching.length===1?matching[0].url:undefined),pageTrackId:`html:${j}`,pageTrackIndex:j,active:t.mode==='showing',default:!!element?.default,source:'texttrack'}];
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
  if(biliIdentity){
    const pageUrl=new URL(location.href),routeBvid=pageUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || pageUrl.searchParams.get('bvid') || '';
    let state=window.__INITIAL_STATE__ || {},pageNumber=Math.max(1,Number(pageUrl.searchParams.get('p')) || 1),identity=resolveIdentity(location.href,state,pageNumber),freshDetail;
    // A stale/missing SPA state must not disable the current video. Resolve it
    // from Bilibili's public view API using only the bvid in the current URL.
    if(!identity.valid){try{
      const urlBvid=routeBvid;
      if(urlBvid){const api=new URL('https://api.bilibili.com/x/web-interface/view');api.search=new URLSearchParams({bvid:urlBvid});const r=await fetch(api,{credentials:'include',signal:AbortSignal.timeout(10000)}),value=await r.json();if(value.code===0&&String(value.data?.bvid||'')===urlBvid){freshDetail=value.data;state={videoData:freshDetail};identity=resolveIdentity(location.href,state,pageNumber);}}
    }catch{}}
    const candidateDetail=freshDetail || state.videoData || {},detail=String(candidateDetail.bvid||'')===routeBvid?candidateDetail:{},part=detail.pages?.[pageNumber-1],bvid=routeBvid || undefined,cid=identity.valid?identity.cid:0;
    let data,sourceFailure;
    // Never reuse __playinfo__: it can belong to the previous SPA route. A
    // transient playurl response is retried once, but route identity is
    // checked before and after every request so an SPA navigation cannot leak
    // the previous part's source into this snapshot.
    const playurlFailure=(code,message,extra={})=>({code,message,sourceStage:'bilibili-playurl',...extra});
    const classifyPlayurl=(error,status,apiCode)=>{
      if(error?.code==='SOURCE_CHANGED')return playurlFailure('SOURCE_CHANGED','Bilibili 路由已變更');
      if(status===401||status===403||status===412||apiCode===-101||apiCode===-412||apiCode===-403)return playurlFailure('HTTP_AUTH','Bilibili 播放來源拒絕請求',{httpStatus:status,apiCode});
      if(status===404)return playurlFailure('HTTP_NOT_FOUND','Bilibili 播放來源不存在',{httpStatus:status,apiCode});
      if(status===429||apiCode===-429)return playurlFailure('HTTP_RATE_LIMIT','Bilibili 請求過於頻繁',{httpStatus:status,apiCode});
      if(status>=500)return playurlFailure('HTTP_SERVER','Bilibili 播放服務暫時無回應',{httpStatus:status,apiCode});
      if(error?.name==='TimeoutError')return playurlFailure('NETWORK_TIMEOUT','Bilibili 播放來源讀取逾時',{httpStatus:status,apiCode});
      if(error&&apiCode===undefined)return playurlFailure('NETWORK_FAILURE','Bilibili 播放來源讀取失敗',{httpStatus:status,apiCode});
      return playurlFailure('SOURCE_UNAVAILABLE','Bilibili 未提供有效播放來源',{httpStatus:status,apiCode});
    };
    const routeNow=()=>{try{const u=new URL(location.href),rb=u.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || u.searchParams.get('bvid') || '',rp=Math.max(1,Number(u.searchParams.get('p'))||1),ri=resolveIdentity(location.href,window.__INITIAL_STATE__ || {},rp);return {bvid:rb,page:rp,cid:ri.valid?ri.cid:0};}catch{return {bvid:'',page:0,cid:0};}};
    const routeMatches=expected=>{const current=routeNow();return current.bvid===expected.bvid&&current.page===expected.page&&(!current.cid||current.cid===expected.cid);};
    if(identity.valid){
      const expected={bvid,page:pageNumber,cid};
      for(let attempt=0;attempt<2&&!data&&!sourceFailure;attempt++){
        if(!routeMatches(expected)){sourceFailure=playurlFailure('SOURCE_CHANGED','Bilibili 路由已變更');break;}
        try{
          const api=new URL('https://api.bilibili.com/x/player/playurl');api.search=new URLSearchParams({bvid,cid,qn:'80',fnval:'4048',fnver:'0',fourk:'1'});
          const r=await fetch(api,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(5000)});
          if(!r.ok){const failure=classifyPlayurl(null,r.status);if(attempt===0&&r.status>=500){await new Promise(resolve=>setTimeout(resolve,250));continue;}sourceFailure=failure;break;}
          const value=await r.json(),apiCode=Number(value?.code)||0;
          if(apiCode!==0){const failure=classifyPlayurl(new Error('api'),0,apiCode);sourceFailure=failure;break;}
          if(String(value.data?.bvid||bvid)!==bvid||Number(value.data?.cid||cid)!==cid){sourceFailure=playurlFailure('SOURCE_CHANGED','Bilibili 播放來源身份不一致',{apiCode});break;}
          if(!routeMatches(expected)){sourceFailure=playurlFailure('SOURCE_CHANGED','Bilibili 路由已變更');break;}
          if(!value.data || (!value.data.dash?.video?.length&&!value.data.durl?.length)){if(attempt===0){await new Promise(resolve=>setTimeout(resolve,250));continue;}sourceFailure=playurlFailure('SOURCE_UNAVAILABLE','Bilibili 未回傳可下載格式',{apiCode});break;}
          data=value.data;
        }catch(error){const failure=classifyPlayurl(error);if(attempt===0&&(failure.code==='NETWORK_FAILURE'||failure.code==='NETWORK_TIMEOUT')){await new Promise(resolve=>setTimeout(resolve,250));continue;}sourceFailure=failure;}
      }
    }
    const cleanTitle=value=>String(value || '').trim(),validTitle=value=>value&&!/^\d{11,}$/.test(value),heading=document.querySelector('h1.video-title,.video-info-title h1,h1[title]'),metaTitle=cleanTitle(document.querySelector('meta[property="og:title"]')?.content);
    title=[cleanTitle(detail.title),cleanTitle(heading?.getAttribute('title')),cleanTitle(heading?.textContent),metaTitle,cleanTitle(title).replace(/[_\s-]*(?:哔哩哔哩|嗶哩嗶哩)(?:[_\s-]*bilibili)?$/i,'')].find(validTitle) || 'Bilibili video';
    for(const candidate of candidates)if(candidate.bilibiliMain)candidate.title=title;
    const parts=(detail.pages || []).map((entry,i)=>({page:i+1,cid:Number(entry.cid)||0,title:cleanTitle(entry.part)||`P${i+1}`,duration:Number(entry.duration)||0}));
    if(!parts.length&&Number(detail.cid)>0)parts.push({page:1,cid:Number(detail.cid),title:cleanTitle(detail.title)||'P1',duration:Number(detail.duration)||0});
    const routePlatform=bvid?{site:'bilibili',bvid,aid:Number(detail.aid)||0,cid,page:pageNumber,pages:parts,title,partTitle:validTitle(cleanTitle(part?.part))?cleanTitle(part.part):'',duration:(Number(data?.timelength)||0)/1000 || Number(part?.duration)||0,data,...(sourceFailure?{sourceFailure}:{})}:undefined;
    // The watch URL is an independent, verified download target. Keep it even
    // while closed-shadow/floating players temporarily hide their DOM owner.
    // Do not assign it to an unrelated selected video or advertisement.
    if(biliPlayers.has(video))platform=routePlatform;
    if(identity.valid)bilibiliContext=routePlatform;
    captionStatus='unavailable';
    // Subtitle discovery is performed by the background using the player's
    // binary metadata endpoint, never the unsigned legacy JSON caption list.
    const currentUrl=new URL(location.href),currentBvid=currentUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || currentUrl.searchParams.get('bvid') || '',currentPage=Math.max(1,Number(currentUrl.searchParams.get('p'))||1);
    if(currentBvid!==String(bvid||'') || currentPage!==pageNumber){
      tracks.length=0;registry.tracks.set(video,[]);platform=undefined;bilibiliContext=undefined;captionStatus='unavailable';
    }else if(identity.valid){
      registry.bilibiliIdentity={bvid,cid,page:pageNumber,videoData:detail,duration:Number(data?.timelength||0)/1000 || Number(part?.duration) || (detail.pages?.length===1?Number(detail.duration):0) || (Number.isFinite(video?.duration)?video.duration:0)};
    }
  }
  if(!videos.length&&platform?.site==='twitch')candidates.push({title,url:location.href,downloadUrl:location.href,referer:location.href,mediaKey:'twitch-vod:'+platform.id,mediaIdentity:platform.id});
  if(dailymotionMain(video))try{
    // Prefer requests demonstrably used by this main player. Ambient resource
    // entries, ad players and unassociated metadata are not playback proof.
    const owned=(sourceObserver?.sourcesFor?.(video)?.candidates || []).filter(item=>item.downloadable!==false&&['hls','dash','progressive'].includes(item.kind)&&item.evidence?.some(e=>/^(?:mse-|blob-http-body|video\.(?:currentSrc|src)|source-element)/.test(e))&&http(item.url));
    if(owned.length===1){const observed={url:http(owned[0].url),type:owned[0].kind};candidates[mediaIndex].observedSource=observed;if(platform?.site==='dailymotion')platform.observedSource=observed;}
  }catch{}
  if(video&&!platform&&!candidates[mediaIndex]?.downloadUrl&&!candidates[mediaIndex]?.linkedMedia)try{
    const plan=deepTake()?sourceObserver?.metadataCandidatesFor?.(video,videos):null;
    if(plan?.versions?.length)platform={site:'metadata-media',binding:'metadata-unbound',expectedDuration:plan.expectedDuration,versions:plan.versions,validationToken:plan.token,bindingKey:plan.bindingKey};
  }catch{}
  // Keep every established route ahead of this Vimeo-only late-open repair.
  // Its independent timeout cannot consume the old exploration budget.
  if(video&&!platform&&!candidates[mediaIndex]?.downloadUrl&&!candidates[mediaIndex]?.linkedMedia&&/^(?:(?:www|player)\.)?vimeo\.com$/i.test(location.hostname))try{
    const recovered=await sourceObserver?.resolvePlayerModelFor?.(video);
    if(recovered){
      platform={...recovered,site:'embedded'};embeddedModel=recovered;snapshotModels.set(video,recovered);
      Object.assign(candidates[mediaIndex],{title:resolveTitle(video,mediaIndex,recovered.title),mediaIdentity:recovered.id||candidates[mediaIndex].mediaIdentity,mediaContentId:recovered.id||candidates[mediaIndex].mediaContentId,recoveryIdentity:!!recovered.id||candidates[mediaIndex].recoveryIdentity});
    }
  }catch{}
  let discoveryDiagnostics;try{if(video&&!earlyPlatform&&!embeddedModel)discoveryDiagnostics=sourceObserver?.diagnosticsFor?.(video);}catch{}
  discoveryDiagnostics={...(discoveryDiagnostics||{}),explorationReason:deepReason,count:deepCount,timingMs:Math.round(clock()-deepStarted)};
  return {url:location.href,title,tracks,platform,dailymotionContext,bilibiliContext,captionStatus,captionInventory:Array.isArray(renderer?.captionTracks),videos:candidates,mediaIndex,preferredMediaIndex,language:document.documentElement.lang,preferredLanguages:navigator.languages,media:video?{url:source(video),mediaKey:identities.keys.get(video),discoveryReason:candidates[mediaIndex]?.discoveryReason,discoveryDiagnostics,drm:!!video.mediaKeys,time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:null}:null};
}
export { pageSubtitles } from './page-subtitles.js';
