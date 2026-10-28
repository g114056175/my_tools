import {toText,exportSubtitle,clock} from './subtitles.js';
import {selectTrack,orderTracks,mergeTracks,trackLabel} from './tracks.js';
import {formatSize} from './sizes.js';
import {ACTIVE_STATES,visibleJobs,jobLabel,FINISH_VISIBILITY_MS,activeDownloadJob as findActiveDownloadJob} from './jobs.js';
import {normalizePreferences,availableQuality,PRESERVED_QUALITY,videoQualityOptions,resolvedVideoQuality} from './preferences.js';
import {classifyFailure,briefFailure,briefSubtitleWarning,visibleFailure,ERROR_VISIBILITY_MS} from './diagnostics.js';
import {CAPTURE_PREFIX,CAPTURE_VERSION,captureScope as makeCaptureScope,captureKey as makeCaptureKey} from './subtitle-captures.js';
import {suggestedFilename} from './filenames.js';
import {mediaAvailability,popupAvailability,restoredKind,sourceVisibility,sourceHeader,sourceDeadline,mediaTitleLabel,orderedMediaOptions,sourceInspectionDiagnostic} from './popup-state.js';
import {createMediaMenu} from './media-menu.js';
import {bindPopupTheme} from './popup-theme.js';
import {createMediaPresenceMonitor,mediaTargetKey} from './media-presence-monitor.js';
import {createRangeController} from './range-controls.js';
import {stableHash} from './download-identity.js';
import {genericFallbackEligible} from './generic-fallback.js';
import './destinations.js';
const $=id=>document.getElementById(id);
bindPopupTheme($('themeToggle'));
const COPY_DIAGNOSTICS=false;
let rangeSelection,rangeDraft=null,rangeRestoredTarget='',restoringRange=false,rangeDraftSerialized='';
const rangeController=createRangeController({details:$('rangeSettings'),start:$('rangeStart'),end:$('rangeEnd'),length:$('rangeDuration'),startSlider:$('rangeStartSlider'),endSlider:$('rangeEndSlider'),timeline:$('rangeSliders'),message:$('rangeMessage')},{onChange:value=>{rangeSelection=value;updateDownloadLabel();rememberRangeDraft();}});
let mediaMenu={render(){}};
let tab,page,subtitle=null,kind='video',mediaIndex=0,info=null,tracks=[],probePromise,revision=0,chosenTrackId=null,jobTimer,jobRevision=0,captionPollTimer,captionPollActive=false,captionPollDeadline=0,captureScopeValue=null,captureRecords=[],captureRecord=null,currentCaptureKey=null,restoreRevision=0;
let requestedKind='video',errorTimer,currentErrorId=null,currentFailure=null,sourceError='',sourceErrorDetail='',sourceFailureDismissed=false,dismissedCaptureWarningKey=null;
let sessionJobs=[],sourcePhase='detecting',inspectionId=null,inspectionFailure=null;
const openedAt=Date.now(),popupPort=chrome.runtime.connect({name:'popup'});
const presenceMonitor=createMediaPresenceMonitor({
 targets:()=>sourcePhase==='detecting'||busyControls.has('loadSubtitle')||captureRecord?.state==='running'?[]:(page?.videos||[]).filter(video=>!video.routeOnly&&typeof video.documentId==='string'&&Number.isInteger(video.frameId)&&video.mediaKey!=null).map(video=>({documentId:video.documentId,frameId:video.frameId,mediaKey:video.mediaKey})),
 read:targets=>send('mediaPresence',{tabId:tab.id,targets}),
 onMissing:removeMissingMedia,
});
const markerRequests=new Map();
popupPort.onMessage?.addListener(message=>{if(message.action==='highlightReady')markerRequests.get(message.operationId)?.();});
function highlightSelected(target,scrollIntoView=false){
 const message={action:'highlightMedia',tabId:tab.id,documentId:target.documentId,mediaKey:target.mediaKey,title:target.title || page?.title,scrollIntoView};
 if(!scrollIntoView||!popupPort.onMessage){popupPort.postMessage?.(message);return Promise.resolve();}
 const operationId=crypto.randomUUID();return new Promise(resolve=>{const finish=()=>{clearTimeout(timer);markerRequests.delete(operationId);resolve();},timer=setTimeout(finish,1500);markerRequests.set(operationId,finish);popupPort.postMessage?.({...message,operationId});});
}
const markerHeartbeat=setInterval(()=>{try{popupPort.postMessage?.({action:'renewHighlight'});}catch{clearInterval(markerHeartbeat);}},3000);
popupPort.onDisconnect?.addListener(()=>{clearInterval(markerHeartbeat);presenceMonitor.stop();for(const finish of [...markerRequests.values()])finish();});
const busyControls=new Set();
let preferences=normalizePreferences(),preferenceWrites=Promise.resolve();
function savePreference(key,value){preferences[key]=String(value);const stored={...preferences};preferenceWrites=preferenceWrites.catch(()=>{}).then(()=>chrome.storage.local.set({downloadPreferences:stored}));return preferenceWrites;}
function sourceState(error='',detail=''){
  if(arguments.length){if(sourceError!==(error||'')||sourceErrorDetail!==(detail||''))sourceFailureDismissed=false;sourceError=error || '';sourceErrorDetail=detail || '';}
  const hasVideo=!!page?.videos?.length,multiple=hasVideo&&page.videos.length>1,visibility=sourceVisibility({info,tracks,kind});
  const header=sourceHeader({hasVideo,info,tracks,phase:sourcePhase,error:sourceError,detail:sourceErrorDetail});
  $('sourceLabel').textContent=header.label==='Video:'&&!hasVideo?'No video found':header.label;$('sourceLabel').hidden=hasVideo&&header.label==='Video:';$('sourceLabel').classList.toggle('error',header.error);$('sourceLabel').title=COPY_DIAGNOSTICS?header.detail+(header.error?' · Click to copy diagnostics':''):'';$('sourceLabel').tabIndex=COPY_DIAGNOSTICS&&header.error?0:-1;$('sourceLabel').setAttribute('role',COPY_DIAGNOSTICS?'button':'status');
  $('pageTitle').hidden=header.error||!hasVideo||multiple;$('mediaSelect').hidden=!multiple;
  const title=hasVideo?(page.videos[mediaIndex]?.title || page.title):'No video';$('pageTitle').textContent=mediaTitleLabel(title);$('pageTitle').title=hasVideo?title:'';
  $('downloadSection').hidden=!visibility.showDownloadSection;$('subtitleSection').hidden=!visibility.showSubtitleSection;$('subtitleSettings').hidden=!visibility.showSubtitleSection;mediaMenu.render();renderFailure();
}
function renderMediaOptions(){
 $('mediaSelect').replaceChildren();for(const {index,title} of orderedMediaOptions(page?.videos||[])){const option=new Option(mediaTitleLabel(title),String(index));option.title=title;$('mediaSelect').add(option);}
 $('mediaSelect').value=String(mediaIndex);$('mediaSelect').title=page?.videos?.[mediaIndex]?.title || page?.title || '';mediaMenu.render();
}
async function removeMissingMedia(missing){
 if(!page?.videos?.length)return;
 const gone=new Set(missing.map(mediaTargetKey)),selected=page.videos[mediaIndex];
 if(selected&&gone.has(mediaTargetKey(selected))){await refresh(false,true,false,null,false);return;}
 const remaining=page.videos.filter(video=>!gone.has(mediaTargetKey(video)));if(remaining.length===page.videos.length)return;
 mediaIndex=Math.max(0,remaining.indexOf(selected));page={...page,videos:remaining,mediaIndex};renderMediaOptions();sourceState();
}
function notice(text='',error=false){if(error){showFailure({message:text});return;}$('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error);}
async function send(action,data={}){const r=await chrome.runtime.sendMessage({action,...data});if(!r?.ok)throw Object.assign(new Error(r?.error || 'Action failed'),r?.failure || {});return r.result;}
function bind(id,fn){$(id).addEventListener('click',async()=>{const b=$(id);busyControls.add(id);b.disabled=true;try{await fn();}catch(e){const stage=['loadSubtitle','copy','saveSubtitle'].includes(id)?'subtitle':'inspect',failure=classifyFailure(e,stage);notice();if(failure.code!=='CANCELLED'){showFailure(failure);if(!e.code)void send('reportFailure',{failure,stage,kind,platform:page?.platform?.site}).catch(()=>{});}}finally{busyControls.delete(id);b.disabled=false;syncButtons();}});}
function mediaDiscoveryHint(){const reason=page?.media?.discoveryReason,diagnostics=page?.media?.discoveryDiagnostics,hint=({'no-associated-source':'No URL or stream manifest is linked to the player','ambiguous-source':'Multiple candidate sources; cannot identify one for this video','ambiguous-mse-roots':'The player has multiple stream groups; cannot safely match a source','worker-mse-not-trackable':'The player uses an isolated worker stream whose source cannot be verified','buffer-source-not-observed':'Video is loaded, but its source was not detected'}[reason] || (reason?`Media source status: ${reason}`:''));return [hint,diagnostics?`JSON ${diagnostics.json?.observed || 0} · models ${diagnostics.models || 0} · matches ${diagnostics.matches || 0} · ${diagnostics.reason || ''}`:''].filter(Boolean).join(' · ');}
function trackKey(t){return t.trackId;}
function selectedTrack(){return tracks.find(t=>trackKey(t)===$('language').value);}

function addTracks(){
  const previous=chosenTrackId,preferences=[...(page?.preferredLanguages || []),chrome.i18n.getUILanguage(),page?.language],available=mergeTracks(page,info?.tracks || []),ids=new Set(available.map(trackKey));
  for(const record of captureRecords)if(record.track?.trackId&&!ids.has(record.track.trackId)){available.push(record.track);ids.add(record.track.trackId);}
  tracks=orderTracks(available,preferences);$('language').replaceChildren();
  for(const t of tracks)$('language').add(new Option(trackLabel(t,'en'),trackKey(t)));
  if(tracks.some(t=>trackKey(t)===previous))$('language').value=previous;
  else{const chosen=selectTrack(tracks,preferences);if(chosen)$('language').value=trackKey(chosen);}
  $('language').title=$('language').selectedOptions[0]?.textContent || '';
  if(!tracks.length)$('language').add(new Option(captionPollActive?'Loading captions…':probePromise?'Loading…':page?.captionStatus==='login-required'?'Sign in to Bilibili':'No captions',''));
  if(!tracks.length&&!probePromise)subtitle=null;
  syncModeTabs();sourceState();$('language').disabled=!tracks.length;updateSubtitleLabel();syncButtons();
}
function selectedCapability(){return kind==='video'?info?.choices?.video?.[$('videoFormat').value]:kind==='audio'?info?.choices?.audio?.[$('audioFormat').value]:null;}
function videoQualityKey(){return resolvedVideoQuality($('height').value,preferences.height,info?.choices?.video?.[$('videoFormat').value]?.heights || []);}
function syncChoicePresentation(selectId,valueId){const select=$(selectId),value=$(valueId);if(!select||!value)return;const choices=[...select.options].filter(option=>!option.disabled);const single=choices.length===1;select.hidden=single;value.hidden=!single;value.textContent=single?choices[0].textContent:'';value.setAttribute('aria-hidden',String(!single));}
function syncChoicePresentations(){for(const [selectId,valueId] of [['videoFormat','videoFormatValue'],['height','heightValue'],['audioFormat','audioFormatValue'],['audioQuality','audioQualityValue'],['subtitleFormat','subtitleFormatValue']])syncChoicePresentation(selectId,valueId);}
function applyRangeCapability(){const base=info?.range,warning=$('rangeWarning');if(warning)warning.hidden=true;if(!base){rangeController.setCapability(info?{supported:false,reason:'Clip range is unavailable for this source'}:undefined);return;}const key=kind==='video'?videoQualityKey():$('audioQuality').value,plans=base.plans?.[kind],detail=base.planDetails?.[kind]?.[key];rangeController.setCapability(plans&&Object.prototype.hasOwnProperty.call(plans,key)?{...base,supported:plans[key]===true}:base);if(warning){warning.hidden=detail?.mode!=='full-cut'||plans?.[key]!==true;warning.title=detail?.estimatedInputBytes>0?`Full source: ${formatSize({bytes:detail.estimatedInputBytes,approximate:detail.sizeKnown!==true})}`:'Full source size unknown';}}
function activeDownloadJob(){return findActiveDownloadJob(sessionJobs,info?.downloadKey);}
function syncModeTabs(){
  const available=popupAvailability(info,tracks),busy=busyControls.has('loadSubtitle');
  for(const name of ['video','audio','subtitle']){
    const button=$(name+'Tab');button.disabled=!available[name]||busy;
    button.title=available[name]?'':name==='subtitle'?(captionPollActive?'Waiting for captions':'No downloadable captions for this video'):'No formats available from this source';
  }
  const next=restoredKind(requestedKind,available);
  if(next!==kind){kind=next;for(const name of ['video','audio','subtitle']){$(name+'Tab').classList.toggle('active',name===kind);$(name+'Tab').setAttribute('aria-selected',String(name===kind));if(name!=='subtitle')$(name+'Settings').hidden=name!==kind;}$('subtitleSection').hidden=kind!=='subtitle';$('download').hidden=kind==='subtitle';}
  if($('rangeSettings'))$('rangeSettings').hidden=kind==='subtitle'||!selectedCapability()?.enabled||!rangeController.getState().supported;
}
function syncButtons(){const active=activeDownloadJob(),locked=!!active;syncModeTabs();const selected=selectedCapability(),qualityKey=kind==='video'?videoQualityKey():$('audioQuality').value;$('download').disabled=busyControls.has('download')||locked||!selected?.enabled;$('download').title=locked?`${active.state==='queued'||active.state==='choosing'?'Added to downloads':'Downloading'}${rangeSelection?' · Unknown size':selected?.sizes?.[qualityKey]?` · ${formatSize(selected.sizes[qualityKey])}`:''}`:'';$('loadSubtitle').disabled=!tracks.length||busyControls.has('loadSubtitle')||captureRecord?.state==='running';$('language').disabled=!tracks.length||busyControls.has('loadSubtitle');$('subtitleFormat').disabled=busyControls.has('loadSubtitle');$('mediaSelect').disabled=busyControls.has('loadSubtitle');$('refresh').disabled=busyControls.has('loadSubtitle')||busyControls.has('refresh');$('copy').disabled=!subtitle||busyControls.has('copy');$('saveSubtitle').disabled=!subtitle||busyControls.has('saveSubtitle');$('subtitleTab').title=tracks.length?'Subtitles':captionPollActive?'Waiting for captions':probePromise?'Loading captions':page?.captionStatus==='login-required'?'Sign in to Bilibili first':page?.captionStatus==='unavailable'?'Captions are unavailable. Refresh to try again.':'No downloadable captions for this video';sourceState();updateDownloadLabel();}
function updateDownloadLabel(){if(kind==='subtitle')return;const capability=selectedCapability(),key=kind==='video'?videoQualityKey():$('audioQuality').value,size=capability?.sizes?.[key],ext=capability?.extensions?.[key],active=activeDownloadJob();if(ext)$(kind==='video'?'videoFormat':'audioFormat').options[0].textContent=ext.toUpperCase();syncChoicePresentations();const base=kind==='video'?'Download video':'Download audio';$('download').textContent=active?(active.state==='queued'||active.state==='choosing'?'Added to downloads':'Downloading…'):(rangeSelection&&kind!=='subtitle'?`Download clip (${formatRangeLabel(rangeSelection)})`:base+(capability?.enabled?` (${formatSize(size)})`:''));}
function formatRangeLabel(range){const ticks=Math.max(0,Math.round((range.end-range.start)*10));return `${Math.floor(ticks/600).toString().padStart(2,'0')}:${(Math.floor(ticks/10)%60).toString().padStart(2,'0')}`+(ticks%10?'.'+ticks%10:'');}
function rangeDraftTarget(){const video=page?.videos?.[mediaIndex];return video?.documentId&&video.mediaKey!=null?JSON.stringify([video.documentId,video.bilibiliMain?video.mediaIdentity:video.mediaKey,stableHash(video.mediaContentId||video.linkedMedia?.id||video.url||'')]):'';}
function rememberRangeDraft(){const target=rangeDraftTarget();if(restoringRange||sourcePhase!=='ready'||!target||target!==rangeRestoredTarget||!tab?.id)return;const state=rangeController.getState();if(!state.supported)return;const range=state.start>0.0005||state.end<state.duration-0.0005?{start:state.start,end:state.end}:null;const record={target,range,open:!!$('rangeSettings')?.open},serialized=JSON.stringify(record);if(serialized===rangeDraftSerialized)return;rangeDraft=record;rangeDraftSerialized=serialized;void chrome.storage.session.set({['rangeDraft:'+tab.id]:record}).catch(()=>{});}
function restoreRangeDraft(){const target=rangeDraftTarget();if(!target||target===rangeRestoredTarget)return;restoringRange=true;try{const range=rangeDraft?.target===target?rangeDraft.range:null;if(range&&Number.isFinite(range.start)&&Number.isFinite(range.end)&&range.start>=0&&range.end>range.start&&range.end<=Number(info?.duration)&&rangeController.getState().supported)rangeController.setRange(range);if(rangeDraft?.target===target)rangeController.setEnabled(!!rangeDraft.open);}finally{restoringRange=false;rangeRestoredTarget=target;}}
$('rangeSettings')?.addEventListener('toggle',rememberRangeDraft);
function updateSubtitleLabel(){const end=subtitle?.cues?.reduce((n,c)=>Math.max(n,c.end),0);$('loadSubtitle').textContent=captureRecord?.state==='running'?'Capturing…':subtitle?('Capture ('+subtitle.cues.length+' cues · '+clock(end).slice(0,-4)+(subtitle.partial?' · partial':'')+')'):'Capture';$('loadSubtitle').title=subtitle?.approximateEnds?'End time is estimated':'';}
function updatePreview(){if(subtitle)$('preview').value=exportSubtitle(subtitle,$('subtitleFormat').value).content;}
function updateQuality(){
  const video=info?.choices?.video?.[$('videoFormat').value],heights=video?.heights || [];$('height').replaceChildren();
  const quality=videoQualityOptions(preferences.height,heights);for(const item of quality.options){const option=new Option(item.label,item.value);option.title=item.title || '';$('height').add(option);}
  $('height').value=quality.selected;$('height').title=$('height').selectedOptions[0]?.title || '';$('height').disabled=!video?.enabled;
  const audio=info?.choices?.audio?.[$('audioFormat').value];$('audioQuality').replaceChildren();
  for(const q of audio?.qualities || ['best'])$('audioQuality').add(new Option(q==='best'?'Best':`${q} kbps`,q));$('audioQuality').value=availableQuality(preferences.audioQuality,[...$('audioQuality').options].map(o=>o.value),'best');$('audioQuality').disabled=!audio?.enabled||(audio?.qualities?.length || 0)<2;
  syncChoicePresentations();applyRangeCapability();updateDownloadLabel();syncButtons();
}
function applyInfo(){
  for(const [id,group] of [['videoFormat','video'],['audioFormat','audio']]){
    const select=$(id);for(const option of select.options){const available=info?.choices?.[group]?.[option.value]?.enabled;option.disabled=!available;option.title=available?'':'Not provided by source';}
    const desired=[...select.options].find(o=>o.value===preferences[id]&&!o.disabled),first=[...select.options].find(o=>!o.disabled);if(desired || first)select.value=(desired || first).value;
    select.disabled=![...select.options].some(o=>!o.disabled);
  }
  updateQuality();syncChoicePresentations();syncModeTabs();addTracks();if(info)restoreRangeDraft();
}
function cancelInspection(){
  if(!inspectionId)return;
  const id=inspectionId;inspectionId=null;
  void send('cancelInspect',{inspectionId:id}).catch(()=>{});
}
function isTikTokPage(value){try{return /(^|\.)tiktok\.com$/i.test(new URL(value || '').hostname);}catch{return false;}}
function tikTokRetryEligible(currentPage,selected){return isTikTokPage(currentPage?.url || tab?.url) && !!selected?.documentId && selected?.mediaKey!=null;}
function sourceRetryIdentityEligible(selected){const key=selected?.mediaKey;return typeof selected?.documentId==='string'&&!!selected.documentId&&Number.isInteger(selected.frameId)&&(Number.isFinite(key)||typeof key==='string'&&!!key.trim());}
async function retryTikTokSource(token,force,selected){
  sourcePhase='inspecting';sourceState('','');
  let readiness;
  try{readiness=await sourceDeadline(()=>send('waitMediaSource',{tabId:tab.id,documentId:selected.documentId,mediaKey:selected.mediaKey,contentId:selected.mediaContentId || selected.linkedMedia?.id || '',settleMs:800,timeoutMs:1800}),2500);}catch{}
  if(token!==revision)return true;
  if(readiness?.changed){
    const failure=Object.assign(new Error('Video changed. Select it again.'),{code:'SOURCE_CHANGED',stage:'inspect'});
    info=null;inspectionFailure=failure;sourcePhase='failed';sourceState('Video changed. Select it again.',failure.message);applyInfo();notice();return true;
  }
  await refresh(force,false,false,selected,false,false);return true;
}
async function inspect(token,force=false,allowSourceRetry=true){
  if(token!==revision)return;
  const currentPage=page,index=mediaIndex,selected=currentPage.videos?.[index] || {},id=crypto.randomUUID();
  inspectionId=id;sourcePhase='inspecting';sourceState('','');
  try{
    const descriptor={tabId:tab.id,documentId:currentPage.documentId,url:selected.downloadUrl,sourceType:selected.sourceType,referer:selected.referer || currentPage.url,title:selected.title || currentPage.title,duration:currentPage.media?.duration,drm:currentPage.media?.drm,platform:currentPage.platform,linkedMedia:selected.linkedMedia,selectionIdentity:selected.selectionIdentity,recoveryIdentity:selected.recoveryIdentity===true,mediaContentId:selected.mediaContentId,mediaIdentity:selected.mediaIdentity,playerUrl:selected.url,mediaKey:selected.mediaKey ?? currentPage.media?.mediaKey,frameId:selected.frameId ?? currentPage.frameId,localMediaIndex:selected.localMediaIndex ?? currentPage.localMediaIndex,mediaIndex:index};
    const missing=!selected.downloadUrl&&!currentPage.platform&&!selected.linkedMedia;
    if(missing&&!genericFallbackEligible(descriptor))throw Object.assign(new Error(mediaDiscoveryHint() || 'No source is available for this video'),{code:'SOURCE_UNAVAILABLE'});
    const value=await sourceDeadline(()=>send(missing?'genericInspect':'inspect',{descriptor,inspectionId:id,force}));
    if(token!==revision)return;
    info=value;inspectionFailure=null;sourcePhase='ready';
    const pendingMetadata=Number(currentPage.media?.discoveryDiagnostics?.metadataQueue)>0;
    if(allowSourceRetry&&tikTokRetryEligible(currentPage,selected)&&!mediaAvailability(value).audio&&pendingMetadata){
      await retryTikTokSource(token,force,selected);return;
    }
    const usable=mediaAvailability(info).video||mediaAvailability(info).audio;
    sourceState(usable?'':'Video found, but no downloadable source',usable?'':'No downloadable video or audio formats are available');applyInfo();notice();
  }catch(e){
    if(token!==revision)return;
    info=null;sourcePhase='failed';
    const failure=classifyFailure(e,'inspect'),labels={SOURCE_UNAVAILABLE:'Video found, but no downloadable source',DRM_UNSUPPORTED:'Protected media cannot be downloaded',HTTP_AUTH:'Access denied. Refresh the page and retry.',HTTP_NOT_FOUND:'Source unavailable. Refresh the page and retry.',HTTP_RATE_LIMIT:'Source rate limit reached',HTTP_SERVER:'Source is temporarily unavailable',NETWORK_TIMEOUT:'Source request timed out',NETWORK_FAILURE:'Could not read source',STREAM_VERIFICATION:'Stream verification failed. Refresh the page and retry.',INCOMPLETE_MEDIA:'Media is incomplete'},detail=[...new Set([failure.code,({'source-request':'Read source','source-head':'Check file information','source-probe':'Read media data','stream-manifest':'Read stream manifest','stream-segment':'Read media segment','bilibili-playurl':'Check Bilibili playback data','dailymotion-metadata':'Check playback data','dailymotion-manifest':'Read stream manifest','linked-document':'Read linked video page','linked-redirect':'Linked video page redirected','linked-ambiguous':'Linked video page has multiple sources','linked-no-model':'Linked video page returned no matching playback data'}[failure.sourceStage] || ''),failure.httpStatus?`HTTP ${failure.httpStatus}`:'',failure.apiCode!==undefined?`API ${failure.apiCode}`:'',failure.requestMethod || '',failure.requestHost || '',e.message || '',failure.code==='SOURCE_UNAVAILABLE'?mediaDiscoveryHint():''].filter(Boolean))].join(' · ');
    if(allowSourceRetry&&failure.code==='SOURCE_UNAVAILABLE'&&tikTokRetryEligible(currentPage,selected)){
      await retryTikTokSource(token,force,selected);return;
    }
    if(allowSourceRetry&&failure.code==='HTTP_AUTH'&&sourceRetryIdentityEligible(selected)){
      if(selected.dailymotionMain){
        sourcePhase='inspecting';sourceState('','');
        try{await sourceDeadline(()=>send('waitMediaSource',{tabId:tab.id,documentId:selected.documentId,mediaKey:selected.mediaKey,contentId:'',settleMs:800,timeoutMs:1800}),2500);}catch{}
        if(token!==revision)return;
      }
      return refresh(force,false,false,selected,false,false,true);
    }
    inspectionFailure=failure;sourceState(labels[failure.code]||'Unable to download',detail);applyInfo();notice();if(!currentErrorId)hideFailure();
    if(failure.code==='NETWORK_TIMEOUT')void send('cancelInspect',{inspectionId:id}).catch(()=>{});
  }finally{
    if(inspectionId===id)inspectionId=null;
    if(token===revision){probePromise=null;addTracks();}
  }
}
function stopBilibiliCaptionPolling(){clearTimeout(captionPollTimer);captionPollTimer=null;captionPollActive=false;}
function startBilibiliCaptionPolling(token){
  stopBilibiliCaptionPolling();captionPollActive=true;captionPollDeadline=Date.now()+12000;addTracks();
  const poll=async()=>{
    captionPollTimer=null;
    if(token!==revision||page?.platform?.site!=='bilibili'){stopBilibiliCaptionPolling();return;}
    if(tracks.length){stopBilibiliCaptionPolling();addTracks();return;}
    if(Date.now()>=captionPollDeadline){stopBilibiliCaptionPolling();addTracks();if(kind==='subtitle')switchKind('video',false);return;}
    try{
      const latest=await send('bilibiliCaptions',{tabId:tab.id,expectedBvid:page.platform.bvid,expectedCid:page.platform.cid,expectedPage:page.platform.page,localMediaIndex:page.localMediaIndex||0,documentId:page.documentId});
      if(token!==revision||!captionPollActive)return;
      if(latest.changed){stopBilibiliCaptionPolling();void refresh(true);return;}
      if(latest.captionStatus)page.captionStatus=latest.captionStatus;
      if(latest.tracks?.length){page.tracks=latest.tracks;stopBilibiliCaptionPolling();addTracks();return;}
    }catch(error){if(token===revision){page.captionFailure=error;stopBilibiliCaptionPolling();addTracks();showFailure(error);}return;}
    if(token===revision&&captionPollActive)captionPollTimer=setTimeout(()=>void poll(),3000);
  };
  captionPollTimer=setTimeout(()=>void poll(),1500);
}
function showSubtitle(value){
  $('subtitleContent').hidden=false;
  subtitle=value;updatePreview();updateSubtitleLabel();
  const key=trackKey(value);if(key){chosenTrackId=key;if(tracks.some(t=>trackKey(t)===key))$('language').value=key;}$('language').title=$('language').selectedOptions[0]?.textContent || '';syncButtons();
}
function switchKind(next,persist=true){if(persist)requestedKind=next;if(next==='subtitle'&&!tracks.length&&!captionPollActive)next='video';kind=next;for(const name of ['video','audio','subtitle']){$(name+'Tab').classList.toggle('active',name===kind);$(name+'Tab').setAttribute('aria-selected',String(name===kind));if(name!=='subtitle')$(name+'Settings').hidden=name!==kind;}$('subtitleSection').hidden=kind!=='subtitle';$('download').hidden=kind==='subtitle';updateQuality();notice();if(persist)return savePreference('kind',requestedKind);}
async function renderJob(){
  const token=++jobRevision,{jobs=[]}=await chrome.storage.session.get('jobs');if(token!==jobRevision)return;sessionJobs=jobs;const shown=visibleJobs(jobs,openedAt).filter(job=>job.state!=='error'||job.requiresDismiss);clearTimeout(jobTimer);$('job').replaceChildren();$('job').hidden=!shown.length;
  for(const job of shown){
    const row=document.createElement('li');row.className='job-row'+(job.state==='error'?' error':'');row.dataset.id=job.id;row.dataset.state=job.state;
    const label=document.createElement('span');label.className='job-label';label.textContent=`${jobLabel(job)} ${job.title || 'Video'}`;label.title=label.textContent+(job.state==='error'?`: ${job.message} (${job.errorCode || 'INTERNAL_ERROR'})`:'');row.append(label);
    if(['running','paused','interrupted','retrying','processing'].includes(job.state)&&Number.isFinite(job.progress)){const pct=Math.max(0,Math.min(100,job.progress)),number=document.createElement('span');number.className='job-percent';number.textContent=`${Math.round(pct)}%`;row.append(number);const bar=document.createElement('progress');bar.max=100;bar.value=pct;row.append(bar);}
    if(['queued','running','paused','interrupted','retrying'].includes(job.state)){const toggle=document.createElement('button');toggle.className='icon-button job-toggle';const resume=['paused','interrupted'].includes(job.state);toggle.textContent=resume?'▶':'Ⅱ';toggle.title=resume?'Resume':'Pause';toggle.setAttribute('aria-label',`${toggle.title} ${job.title || 'Video'}`);toggle.addEventListener('click',async()=>{toggle.disabled=true;try{await send(resume?'resume':'pause',{id:job.id});}catch(e){showFailure(e);}});row.append(toggle);}
    if(ACTIVE_STATES.has(job.state)||job.requiresDismiss){const cancel=document.createElement('button');cancel.className='icon-button';cancel.textContent='×';cancel.title=job.requiresDismiss?'Remove record':'Cancel';cancel.setAttribute('aria-label',`${cancel.title} ${job.title || 'Video'}`);cancel.addEventListener('click',async()=>{cancel.disabled=true;try{await send(job.requiresDismiss?'dismissJob':'cancel',{id:job.id});if(job.requiresDismiss)await renderJob();}catch(e){showFailure(e);}});row.append(cancel);}
    $('job').append(row);
  }
  const endings=shown.filter(j=>!ACTIVE_STATES.has(j.state)&&!j.requiresDismiss).map(j=>j.finishedAt+FINISH_VISIBILITY_MS-Date.now());if(endings.length)jobTimer=setTimeout(()=>void renderJob(),Math.max(20,Math.min(...endings)+10));syncButtons();
}
async function restoreSelectedCapture(token=revision){
   const turn=++restoreRevision,chosen=selectedTrack();subtitle=null;captureRecord=null;currentCaptureKey=null;$('preview').value='';$('subtitleContent').hidden=true;if(!currentErrorId)hideFailure();
  if(!chosen||!captureScopeValue){updateSubtitleLabel();syncButtons();return;}
  const key=await makeCaptureKey(tab.id,captureScopeValue,chosen);
  if(token!==revision||turn!==restoreRevision||trackKey(selectedTrack()||{})!==trackKey(chosen))return;
  currentCaptureKey=key;const record=captureRecords.find(item=>item.key===key);
  if(record?.state==='complete'&&record.value?.cues?.length){captureRecord=record;showSubtitle(record.value);}
  else if(record?.state==='running'){captureRecord=record;notice('Capturing…');}
   else if(record?.state==='failed'){captureRecord=record;showFailure(record.failureDetail || {code:record.failureCode});}
  updateSubtitleLabel();syncButtons();
}
function updateCaptureRecord(key,record){
   if(!record||record.version!==CAPTURE_VERSION||record.scope!==captureScopeValue||!key.startsWith(CAPTURE_PREFIX+tab?.id+':'))return;
  captureRecords=captureRecords.filter(item=>item.key!==key);captureRecords.push({key,...record});
  if(key!==currentCaptureKey)return;
  captureRecord=record;
   if(record.state==='complete'&&record.value?.cues?.length){showSubtitle(record.value);notice();if(!currentErrorId)hideFailure();}
   else if(record.state==='running'){subtitle=null;$('preview').value='';$('subtitleContent').hidden=true;notice('Capturing…');if(!currentErrorId)hideFailure();}
   else if(record.state==='failed'){subtitle=null;$('preview').value='';$('subtitleContent').hidden=true;showFailure(record.failureDetail || {code:record.failureCode});}
  updateSubtitleLabel();syncButtons();
}
async function restoreCaptureState(token,currentPage,index){
  const scope=await makeCaptureScope(tab.id,currentPage,index);
  if(token!==revision)return;
  const all=await chrome.storage.session.get(null);
  if(token!==revision)return;
  captureScopeValue=scope;const prefix=CAPTURE_PREFIX+tab.id+':';
  captureRecords=Object.entries(all).filter(([key,record])=>key.startsWith(prefix)&&record?.version===CAPTURE_VERSION&&record.scope===scope).map(([key,record])=>({key,...record}));
  const latest=[...captureRecords].filter(item=>['complete','running','failed'].includes(item.state)).sort((a,b)=>(b.finishedAt||b.startedAt||0)-(a.finishedAt||a.startedAt||0))[0];
  if(!chosenTrackId&&latest?.track?.trackId)chosenTrackId=latest.track.trackId;
  addTracks();await restoreSelectedCapture(token);
}
async function refresh(force=false,explicitMedia=false,scrollToMedia=false,expectedTarget=null,allowWait=true,allowSourceRetry=true,stopOnTargetChange=false){
  const oldIdentity=page?page.url+'|'+page.media?.url+'|'+page.mediaIndex:'';
  cancelInspection();stopBilibiliCaptionPolling();
  const token=++revision;inspectionFailure=null;sourcePhase='detecting';page=null;info=null;tracks=[];subtitle=null;probePromise=null;captureScopeValue=null;captureRecords=[];captureRecord=null;currentCaptureKey=null;sourceError='';sourceErrorDetail='';rangeSelection=undefined;rangeRestoredTarget='';rangeController.reset();$('preview').value='';$('mediaSelect').replaceChildren();$('mediaSelect').value='';$('pageTitle').textContent='';switchKind(kind==='subtitle'?'video':kind,false);applyInfo();
  popupPort.postMessage?.({action:'highlightMedia'});notice();sourceState();
  let nextPage;
  try{nextPage=await sourceDeadline(()=>send('snapshot',{tabId:tab.id,mediaIndex,preferPicked:!explicitMedia,...(expectedTarget?{expectedTarget}:{})}),25000);}
  catch(e){if(token===revision){if(e.code==='SOURCE_CHANGED'&&expectedTarget&&!stopOnTargetChange)return refresh(force,true,false,null,false,allowSourceRetry);sourcePhase='failed';inspectionFailure=classifyFailure(e,'inspect');sourceState(e.code==='SOURCE_CHANGED'?'Video changed. Select it again.':'Could not get video information',e.message);}return;}
  if(token!==revision)return;
  page=nextPage;mediaIndex=page.mediaIndex || 0;sourcePhase=page.videos?.length?'inspecting':'ready';sourceState('','');
  renderMediaOptions();
  if(page.selectionExpired){sourcePhase='failed';inspectionFailure={code:'SOURCE_CHANGED',sourceStage:'selection-inventory'};const placeholder=new Option('Selection changed. Select it again.','');placeholder.disabled=true;$('mediaSelect').add(placeholder);$('mediaSelect').value='';sourceState('Select the video again','The selected video is no longer visible or the source changed. Select it again.');return;}
  if(!page.videos?.length){addTracks();if(!tracks.length)sourceState('Could not get video information','No media source is available in this tab');return;}
  const target=page.videos[mediaIndex];if(!target?.routeOnly&&target?.mediaKey!=null&&target.documentId)await highlightSelected(target,scrollToMedia);
  if(token!==revision)return;
  if(scrollToMedia&&target?.documentId&&target.mediaKey!=null){
    try{await sourceDeadline(()=>send('waitMediaSource',{tabId:tab.id,documentId:target.documentId,mediaKey:target.mediaKey,contentId:target.mediaContentId || target.linkedMedia?.id || '',settleMs:250,timeoutMs:1800}),2500);}catch{}
    if(token!==revision)return;
    return refresh(force,false,false,target,false,allowSourceRetry);
  }
  if(allowWait&&/(^|\.)facebook\.com$/i.test(new URL(page.url).hostname)&&!page.platform&&!target?.downloadUrl&&target?.linkedMedia?.id&&target?.documentId&&target.mediaKey!=null){
    let readiness;try{readiness=await sourceDeadline(()=>send('waitMediaSource',{tabId:tab.id,documentId:target.documentId,mediaKey:target.mediaKey,contentId:target.linkedMedia?.id || '',timeoutMs:3000}),4000);}catch(error){if(error.code==='SOURCE_CHANGED')readiness={changed:true};}
    if(token!==revision)return;
    if(readiness?.changed){sourcePhase='failed';sourceState('Video changed. Select it again.','The feed replaced the original player. No other video was selected.');return;}
    if(readiness?.ready)return refresh(force,false,false,target,false,allowSourceRetry);
  }
  if(oldIdentity!==page.url+'|'+page.media?.url+'|'+page.mediaIndex)chosenTrackId=null;
  probePromise=Promise.resolve().then(()=>inspect(token,force,allowSourceRetry));addTracks();void probePromise;
  // Restoring an optional subtitle cache must never delay media inspection.
  void restoreCaptureState(token,page,mediaIndex).catch(error=>{if(token===revision&&kind==='subtitle')showFailure(error);});
  if(page.platform?.site==='bilibili'&&!tracks.length){if(page.captionFailure)showFailure(page.captionFailure);else startBilibiliCaptionPolling(token);}
}
globalThis.addEventListener?.('pagehide',()=>{revision++;cancelInspection();presenceMonitor.stop();},{once:true});
bind('videoTab',()=>switchKind('video'));bind('audioTab',()=>switchKind('audio'));bind('subtitleTab',()=>switchKind('subtitle'));
for(const id of ['videoFormat','audioFormat','height','audioQuality','subtitleFormat'])$(id).addEventListener('change',()=>{if(id!=='height'||$(id).value!==PRESERVED_QUALITY)void savePreference(id,$(id).value);if(['videoFormat','audioFormat','height'].includes(id))updateQuality();else if(id==='audioQuality'){applyRangeCapability();syncButtons();}else updateDownloadLabel();if(id==='subtitleFormat')updatePreview();});
$('language').addEventListener('change',()=>{chosenTrackId=$('language').value;void restoreSelectedCapture();$('language').title=$('language').selectedOptions[0]?.textContent || '';});
function activateMedia(value){const index=Number(value),target=page?.videos?.[index];if(!target)return;mediaIndex=index;void refresh(false,true,true,target).catch(e=>notice(e.message,true));}
$('mediaSelect').addEventListener('change',()=>activateMedia($('mediaSelect').value));
if($('mediaChooser'))mediaMenu=createMediaMenu($('mediaSelect'),$('mediaChooser'),activateMedia);
bind('pickMedia',async()=>{await send('pickMedia',{tabId:tab.id});window.close();});
bind('refresh',()=>refresh(true,true));
bind('download',async()=>{const cap=selectedCapability();if(!cap?.enabled)throw new Error('Read source information first.');notice();const title=[page.videos?.[mediaIndex]?.title,info.title,page.title].map(value=>String(value || '').trim()).find(value=>value&&!/^(?:影片|video)\s*\d+$/i.test(value)) || '',key=kind==='video'?videoQualityKey():$('audioQuality').value,ext=cap.extensions[key],message={sourceId:info.browserSourceId,downloadKey:info.downloadKey,title,platform:page.platform?.site,kind,height:Number(videoQualityKey()),audioQuality:$('audioQuality').value,range:rangeSelection||undefined};
 if(typeof showSaveFilePicker==='function'){const name=suggestedFilename(title,ext),destinationId=crypto.randomUUID(),reservation=send('prepareDownload',{...message,destinationId});
  try{const handle=await showSaveFilePicker({suggestedName:name});const result=await reservation;if(result?.duplicate)return;VideoPocketDestinations.putNow(handle,destinationId);}catch(error){const job=await reservation.catch(()=>null);if(job?.id&&!job.duplicate)await send('cancel',{id:job.id});throw error;}
 }else await send('download',message);await renderJob();});

bind('loadSubtitle',async()=>{
  let chosen=selectedTrack();if(!chosen&&probePromise){await probePromise;chosen=selectedTrack();}if(!chosen)throw new Error('No original captions are available for this video.');
   const scope=captureScopeValue || await makeCaptureScope(tab.id,page,mediaIndex),key=await makeCaptureKey(tab.id,scope,chosen),selector={videoId:page.platform?.id,pageSource:chosen.pageSource,pageTrackId:chosen.pageTrackId,pageTrackIndex:chosen.pageTrackIndex,captionName:chosen.captionName,apiTrackId:chosen.apiTrackId,rawLanguage:chosen.rawLanguage,trackName:chosen.name,mediaUrl:page.media?.url,mediaKey:page.media?.mediaKey,frameId:page.frameId,documentId:page.documentId,localMediaIndex:page.localMediaIndex};
   if(chosen.pageSource==='bilibili-api')Object.assign(selector,{expectedBvid:chosen.bvid,expectedCid:chosen.cid,expectedPage:chosen.page,explicitPage:chosen.explicitPage,duration:page.platform?.duration || page.media?.duration});
   currentCaptureKey=key;captureRecord={state:'running'};dismissedCaptureWarningKey=null;subtitle=null;$('preview').value='';$('subtitleContent').hidden=true;if(!currentErrorId)hideFailure();updateSubtitleLabel();syncButtons();notice('Capturing…');
  const value=await send('captureSubtitle',{key,scope,tabId:tab.id,documentId:page.documentId,mediaIndex,platform:page.platform?.site,language:chosen.pageLanguage || chosen.language,automatic:chosen.automatic,selector,sourceId:info?.browserSourceId,index:chosen.pageTrackIndex,track:chosen});
  if(currentCaptureKey===key){captureRecord={state:'complete',value};showSubtitle(value);notice();}
});
bind('copy',async()=>{await navigator.clipboard.writeText(exportSubtitle(subtitle,$('subtitleFormat').value).content);notice('Copied');});
bind('saveSubtitle',async()=>{const {format,content}=exportSubtitle(subtitle,$('subtitleFormat').value);const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));setTimeout(()=>URL.revokeObjectURL(url),60000);await chrome.downloads.download({url,filename:suggestedFilename(page.videos?.[mediaIndex]?.title || page.title,format),saveAs:true,conflictAction:'uniquify'});notice();});
function currentCaptureWarning(){
 if(currentFailure||currentErrorId||captureRecord?.state!=='complete')return null;
 const warning=briefSubtitleWarning(captureRecord.value?.warningCode);if(!warning)return null;
 const key=captureRecord.key||currentCaptureKey||`${captureRecord.value?.trackId||''}:${warning.code}`;
 return key===dismissedCaptureWarningKey?null:{...warning,key};
}
function renderFailure(){
 const value=currentFailure&&briefFailure(currentFailure),sourceMessage=page?.videos?.length&&sourceError&&!sourceFailureDismissed?sourceError:'',warning=!value?currentCaptureWarning():null;
 $('diagnosticRow').classList.toggle('warning',!!warning);
 $('diagnosticRow').hidden=!value&&!sourceMessage&&!warning;if(!value&&!sourceMessage&&!warning)return;
 $('diagnosticText').textContent=value?`${COPY_DIAGNOSTICS?'Diagnostics: ':''}${value.message} (${value.code})`:warning?.message||sourceMessage;
 $('diagnosticText').title=COPY_DIAGNOSTICS?'Click to copy diagnostics':'';
}
function hideFailure(){clearTimeout(errorTimer);currentErrorId=null;currentFailure=null;renderFailure();}
function showFailure(error,id=null,remaining=ERROR_VISIBILITY_MS){const value=briefFailure(error);if(!value||(currentErrorId&&id===null))return;clearTimeout(errorTimer);currentErrorId=id;currentFailure=error;renderFailure();errorTimer=setTimeout(()=>{if(currentErrorId!==id)return;hideFailure();if(id)void send('dismissError',{id}).catch(()=>{});},remaining);}
async function renderDiagnostics(){const value=await send('lastError');if(!visibleFailure(value)){if(captureRecord?.state!=='failed')hideFailure();return;}showFailure(value,value.id);}
if(COPY_DIAGNOSTICS)$('diagnosticText').addEventListener('click',async()=>{if(!currentFailure)return;const diagnostic=sourceInspectionDiagnostic({page,mediaIndex,phase:'failed',failure:currentFailure});diagnostic.operation=['download','merge','save','inspect','subtitle'].includes(currentFailure.stage)?currentFailure.stage:'download';await navigator.clipboard.writeText(JSON.stringify(diagnostic,null,2));$('diagnosticText').title='Diagnostics copied';});
$('dismissError').addEventListener('click',()=>{const warning=currentCaptureWarning();if(warning){dismissedCaptureWarningKey=warning.key;renderFailure();return;}const id=currentErrorId;sourceFailureDismissed=true;hideFailure();if(id)void send('dismissError',{id}).catch(()=>{});});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.jobs){void renderJob();syncButtons();}if(area==='session'&&changes.lastError)void renderDiagnostics();for(const [key,change] of Object.entries(changes))if(area==='session'&&key.startsWith(CAPTURE_PREFIX+tab?.id+':'))updateCaptureRecord(key,change.newValue);});

async function init(){[tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id)throw new Error('Open a video page first.');popupPort.postMessage({action:'observeMedia',tabId:tab.id});presenceMonitor.start();await send('recoverDownloads');await VideoPocketDestinations.ready();const stored=await chrome.storage.local.get('downloadPreferences');const session=await chrome.storage.session.get('jobs');sessionJobs=session.jobs || [];preferences=normalizePreferences(stored.downloadPreferences);requestedKind=preferences.kind;$('subtitleFormat').value=preferences.subtitleFormat;switchKind(preferences.kind,false);try{const draft=await sourceDeadline(()=>chrome.storage.session.get('rangeDraft:'+tab.id),1500);rangeDraft=draft?.['rangeDraft:'+tab.id]||null;}catch{}syncButtons();await refresh();await renderJob();await renderDiagnostics();}
init().catch(e=>{notice();sourceState('Could not get video information',e.message);});




async function copySourceDiagnostic(){if(!sourceError)return;await navigator.clipboard.writeText(JSON.stringify(sourceInspectionDiagnostic({page,mediaIndex,phase:sourcePhase,failure:inspectionFailure}),null,2));$('sourceLabel').title='Diagnostics copied';}
if(COPY_DIAGNOSTICS){
 $('sourceLabel').addEventListener('click',()=>void copySourceDiagnostic().catch(()=>{}));
 $('sourceLabel').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void copySourceDiagnostic().catch(()=>{});}});
}
