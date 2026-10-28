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
  const transcriptKey=Symbol.for('video-pocket.transcript'),transcriptRoute=String(location.href);
  try{window.addEventListener?.('pagehide',()=>{delete window[transcriptKey]},{once:true});}catch{}
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
    const cached=window[transcriptKey];
    if(!selected||original.length!==1||cached?.route!==transcriptRoute||cached?.videoId!==response.videoDetails.videoId)return null;
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
        if(res.ok){const data=await res.json(),currentId=new URL(location.href).searchParams.get('v') || location.pathname.split('/shorts/')[1]?.split('/')[0];if(currentId!==response.videoDetails.videoId||player.getPlayerResponse?.()?.videoDetails?.videoId!==response.videoDetails.videoId)throw new Error('影片已變更，請更新影片資訊');if(!data.error){window[transcriptKey]={route:transcriptRoute,videoId:response.videoDetails.videoId,trackId:selected.vssId || `youtube:${selector.pageTrackIndex}`,data};const result=readPayload();if(result)return result;}}
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



