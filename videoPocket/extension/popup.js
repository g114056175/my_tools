import {toText,exportSubtitle,clock} from './subtitles.js';
import {selectTrack,orderTracks,mergeTracks,trackLabel} from './tracks.js';
import {formatSize} from './sizes.js';
import {ACTIVE_STATES,visibleJobs,jobLabel,FINISH_VISIBILITY_MS,activeDownloadJob as findActiveDownloadJob} from './jobs.js';
import {normalizePreferences,availableQuality} from './preferences.js';
import {classifyFailure,briefFailure,visibleFailure,ERROR_VISIBILITY_MS} from './diagnostics.js';
import {CAPTURE_PREFIX,CAPTURE_VERSION,captureScope as makeCaptureScope,captureKey as makeCaptureKey} from './subtitle-captures.js';
import {FILENAME_HISTORY_KEY,filenameHistory,suggestedFilename} from './filenames.js';
import './destinations.js';
const $=id=>document.getElementById(id);
let tab,page,subtitle=null,kind='video',mediaIndex=0,info=null,tracks=[],probePromise,revision=0,chosenTrackId=null,jobTimer,jobRevision=0,captionPollTimer,captionPollActive=false,captionPollDeadline=0,captureScopeValue=null,captureRecords=[],captureRecord=null,currentCaptureKey=null,restoreRevision=0;
let preferredKindPending=null,errorTimer,currentErrorId=null,usedFilenames=[];
let sessionJobs=[];
const openedAt=Date.now(),popupPort=chrome.runtime.connect({name:'popup'});
const busyControls=new Set();
let preferences=normalizePreferences(),preferenceWrites=Promise.resolve();
function savePreference(key,value){preferences[key]=String(value);const stored={...preferences};preferenceWrites=preferenceWrites.catch(()=>{}).then(()=>chrome.storage.local.set({downloadPreferences:stored}));return preferenceWrites;}
function sourceState(error='',detail=''){
  const hasVideo=!!page?.videos?.length,multiple=hasVideo&&page.videos.length>1;
  $('sourceLabel').textContent=error || '目前影片：';$('sourceLabel').classList.toggle('error',!!error);$('sourceLabel').title=detail;
  $('pageTitle').hidden=!!error||multiple;$('mediaSelect').hidden=!multiple;
  $('pageTitle').textContent=hasVideo?(page.videos[mediaIndex]?.title || page.title):'無影片';$('pageTitle').title=hasVideo?$('pageTitle').textContent:'';
  $('downloadSection').hidden=!hasVideo;$('subtitleSection').hidden=!hasVideo||kind!=='subtitle';
}
function notice(text='',error=false){if(error){showFailure({message:text});return;}$('notice').textContent=text;$('notice').hidden=!text;$('notice').classList.toggle('error',error);}
async function send(action,data={}){const r=await chrome.runtime.sendMessage({action,...data});if(!r?.ok)throw Object.assign(new Error(r?.error || '操作失敗'),r?.failure || {});return r.result;}
function bind(id,fn){$(id).addEventListener('click',async()=>{const b=$(id);busyControls.add(id);b.disabled=true;try{await fn();}catch(e){const stage=['loadSubtitle','copy','saveSubtitle'].includes(id)?'subtitle':'inspect',failure=classifyFailure(e,stage);notice();if(failure.code!=='CANCELLED'){showFailure(failure);if(!e.code)void send('reportFailure',{failure,stage,kind,platform:page?.platform?.site}).catch(()=>{});}}finally{busyControls.delete(id);b.disabled=false;syncButtons();}});}
function sourceUrl(){return page?.videos?.[mediaIndex]?.downloadUrl;}
function sourceReferer(){return page?.videos?.[mediaIndex]?.referer || page?.url;}
function trackKey(t){return t.trackId;}
function selectedTrack(){return tracks.find(t=>trackKey(t)===$('language').value);}

function addTracks(){
  const previous=chosenTrackId,preferences=[...(page?.preferredLanguages || []),chrome.i18n.getUILanguage(),page?.language],available=mergeTracks(page,info?.tracks || []),ids=new Set(available.map(trackKey));
  for(const record of captureRecords)if(record.track?.trackId&&!ids.has(record.track.trackId)){available.push(record.track);ids.add(record.track.trackId);}
  tracks=orderTracks(available,preferences);$('language').replaceChildren();
  for(const t of tracks)$('language').add(new Option(trackLabel(t,chrome.i18n.getUILanguage()),trackKey(t)));
  if(tracks.some(t=>trackKey(t)===previous))$('language').value=previous;
  else{const chosen=selectTrack(tracks,preferences);if(chosen)$('language').value=trackKey(chosen);}
  $('language').title=$('language').selectedOptions[0]?.textContent || '';
  if(!tracks.length)$('language').add(new Option(captionPollActive?'讀取字幕中…':probePromise?'讀取中…':page?.captionStatus==='login-required'?'需要登入 Bilibili':'無字幕',''));
  if(!tracks.length&&!probePromise)subtitle=null;
  if(tracks.length&&preferredKindPending==='subtitle'){preferredKindPending=null;switchKind('subtitle',false);}
  $('language').disabled=!tracks.length;updateSubtitleLabel();syncButtons();
}
function selectedCapability(){return kind==='video'?info?.choices?.video[$('videoFormat').value]:kind==='audio'?info?.choices?.audio[$('audioFormat').value]:null;}
function activeDownloadJob(){return findActiveDownloadJob(sessionJobs,info?.downloadKey);}
function syncButtons(){const active=activeDownloadJob(),locked=!!active;$('download').disabled=busyControls.has('download')||locked||!selectedCapability()?.enabled;$('download').title=locked?`${active.state==='queued'||active.state==='choosing'?'已加入下載':'下載中'}${selectedCapability()?.sizes?.[kind==='video'?$('height').value:$('audioQuality').value]?` · ${formatSize(selectedCapability().sizes[kind==='video'?$('height').value:$('audioQuality').value])}`:''}`:'';$('loadSubtitle').disabled=!tracks.length||busyControls.has('loadSubtitle')||captureRecord?.state==='running';$('language').disabled=!tracks.length||busyControls.has('loadSubtitle');$('subtitleFormat').disabled=busyControls.has('loadSubtitle');$('mediaSelect').disabled=busyControls.has('loadSubtitle');$('refresh').disabled=busyControls.has('loadSubtitle')||busyControls.has('refresh');$('copy').disabled=!subtitle||busyControls.has('copy');$('saveSubtitle').disabled=!subtitle||busyControls.has('saveSubtitle');$('subtitleTab').disabled=!tracks.length&&!captionPollActive||busyControls.has('loadSubtitle');$('subtitleTab').title=tracks.length?'字幕':captionPollActive?'等待字幕來源':probePromise?'讀取字幕來源中':page?.captionStatus==='login-required'?'請先登入 Bilibili':page?.captionStatus==='unavailable'?'字幕目前無法取得，請重新整理':'此影片沒有可下載字幕';updateDownloadLabel();}
function updateDownloadLabel(){if(kind==='subtitle')return;const capability=selectedCapability(),key=kind==='video'?$('height').value:$('audioQuality').value,size=capability?.sizes?.[key],ext=capability?.extensions?.[key],active=activeDownloadJob();if(ext)$(kind==='video'?'videoFormat':'audioFormat').options[0].textContent=ext.toUpperCase();$('download').textContent=active?(active.state==='queued'||active.state==='choosing'?'已加入下載':'下載中…'):(kind==='video'?'下載影片':'下載音檔')+(capability?.enabled?`（${formatSize(size)}）`:'');}
function updateSubtitleLabel(){const end=subtitle?.cues?.reduce((n,c)=>Math.max(n,c.end),0);$('loadSubtitle').textContent=captureRecord?.state==='running'?'擷取中…':subtitle?('擷取（'+subtitle.cues.length+' 段 · '+clock(end).slice(0,-4)+(subtitle.partial?' · 部分':'')+'）'):'擷取';$('loadSubtitle').title=subtitle?.approximateEnds?'結束時間為推估':'';}
function updatePreview(){if(subtitle)$('preview').value=exportSubtitle(subtitle,$('subtitleFormat').value).content;}
function updateQuality(){
  const video=info?.choices?.video[$('videoFormat').value];$('height').replaceChildren(new Option('最佳','0'));
  for(const h of video?.heights || [])$('height').add(new Option(`${h}p`,String(h)));$('height').value=availableQuality(preferences.height,[...$('height').options].map(o=>o.value),'0');$('height').disabled=!video?.enabled;
  const audio=info?.choices?.audio[$('audioFormat').value];$('audioQuality').replaceChildren();
  for(const q of audio?.qualities || ['best'])$('audioQuality').add(new Option(q==='best'?'最佳':`${q} kbps`,q));$('audioQuality').value=availableQuality(preferences.audioQuality,[...$('audioQuality').options].map(o=>o.value),'best');$('audioQuality').disabled=!audio?.enabled||(audio?.qualities?.length || 0)<2;
  updateDownloadLabel();syncButtons();
}
function applyInfo(){
  for(const [id,group] of [['videoFormat','video'],['audioFormat','audio']]){
    const select=$(id);for(const option of select.options){const available=info?.choices?.[group]?.[option.value]?.enabled;option.disabled=!available;option.title=available?'':'來源未提供';}
    const desired=[...select.options].find(o=>o.value===preferences[id]&&!o.disabled),first=[...select.options].find(o=>!o.disabled);if(desired || first)select.value=(desired || first).value;
    select.disabled=![...select.options].some(o=>!o.disabled);
  }
  updateQuality();addTracks();
}
async function inspect(token,force=false){
  try{if(!sourceUrl()&&!page.platform)throw new Error('未找到此影片的個別下載網址');const selected=page.videos?.[mediaIndex] || {};const value=await send('inspect',{descriptor:{tabId:tab.id,documentId:page.documentId,url:sourceUrl(),referer:sourceReferer(),title:selected.title || page.title,duration:page.media?.duration,drm:page.media?.drm,platform:page.platform,mediaKey:selected.mediaKey ?? page.media?.mediaKey,frameId:selected.frameId ?? page.frameId,localMediaIndex:selected.localMediaIndex ?? page.localMediaIndex,mediaIndex},force});if(token!==revision)return;info=value;applyInfo();const usable=Object.values(info.choices.video).some(c=>c.enabled)||Object.values(info.choices.audio).some(c=>c.enabled);sourceState(usable?'':'未取得影片資訊',usable?'':'來源未提供可用影音格式',);notice();}
  catch(e){if(token===revision){info=null;applyInfo();sourceState('未取得影片資訊',e.message);notice();if(['HTTP_AUTH','HTTP_NOT_FOUND','HTTP_RATE_LIMIT','DRM_UNSUPPORTED','NETWORK_TIMEOUT','NETWORK_FAILURE'].includes(e.code))showFailure(e);}}
  finally{if(token===revision){probePromise=null;addTracks();}}
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
function switchKind(next,persist=true){if(next==='subtitle'&&!tracks.length&&!captionPollActive){if(!persist)preferredKindPending='subtitle';next='video';}kind=next;for(const name of ['video','audio','subtitle']){$(name+'Tab').classList.toggle('active',name===kind);$(name+'Tab').setAttribute('aria-selected',String(name===kind));if(name!=='subtitle')$(name+'Settings').hidden=name!==kind;}$('subtitleSection').hidden=kind!=='subtitle';$('download').hidden=kind==='subtitle';updateQuality();notice();if(persist){preferredKindPending=null;return savePreference('kind',next);}}
async function renderJob(){
  const token=++jobRevision,{jobs=[]}=await chrome.storage.session.get('jobs');if(token!==jobRevision)return;sessionJobs=jobs;const shown=visibleJobs(jobs,openedAt).filter(job=>job.state!=='error');clearTimeout(jobTimer);$('job').replaceChildren();$('job').hidden=!shown.length;
  for(const job of shown){
    const row=document.createElement('li');row.className='job-row'+(job.state==='error'?' error':'');row.dataset.id=job.id;row.dataset.state=job.state;
    const label=document.createElement('span');label.className='job-label';label.textContent=`${jobLabel(job)} ${job.title || '影片'}`;label.title=label.textContent+(job.state==='error'?`：${job.message}（${job.errorCode || 'INTERNAL_ERROR'}）`:'');row.append(label);
    if(['running','paused','interrupted','retrying'].includes(job.state)&&Number.isFinite(job.progress)){const pct=Math.max(0,Math.min(100,job.progress)),number=document.createElement('span');number.className='job-percent';number.textContent=`${Math.round(pct)}%`;row.append(number);const bar=document.createElement('progress');bar.max=100;bar.value=pct;row.append(bar);}
    if(['queued','running','paused','interrupted','retrying'].includes(job.state)){const toggle=document.createElement('button');toggle.className='icon-button job-toggle';const resume=['paused','interrupted'].includes(job.state);toggle.textContent=resume?'▶':'Ⅱ';toggle.title=resume?'繼續':'暫停';toggle.setAttribute('aria-label',`${toggle.title} ${job.title || '影片'}`);toggle.addEventListener('click',async()=>{toggle.disabled=true;try{await send(resume?'resume':'pause',{id:job.id});}catch(e){showFailure(e);}});row.append(toggle);}
    if(ACTIVE_STATES.has(job.state)){const cancel=document.createElement('button');cancel.className='icon-button';cancel.textContent='×';cancel.title='取消';cancel.setAttribute('aria-label',`取消 ${job.title || '影片'}`);cancel.addEventListener('click',async()=>{cancel.disabled=true;try{await send('cancel',{id:job.id});}catch(e){showFailure(e);}});row.append(cancel);}
    $('job').append(row);
  }
  const endings=shown.filter(j=>!ACTIVE_STATES.has(j.state)).map(j=>j.finishedAt+FINISH_VISIBILITY_MS-Date.now());if(endings.length)jobTimer=setTimeout(()=>void renderJob(),Math.max(20,Math.min(...endings)+10));syncButtons();
}
async function restoreSelectedCapture(token=revision){
   const turn=++restoreRevision,chosen=selectedTrack();subtitle=null;captureRecord=null;currentCaptureKey=null;$('preview').value='';$('subtitleContent').hidden=true;hideFailure();
  if(!chosen||!captureScopeValue){updateSubtitleLabel();syncButtons();return;}
  const key=await makeCaptureKey(tab.id,captureScopeValue,chosen);
  if(token!==revision||turn!==restoreRevision||trackKey(selectedTrack()||{})!==trackKey(chosen))return;
  currentCaptureKey=key;const record=captureRecords.find(item=>item.key===key);
  if(record?.state==='complete'&&record.value?.cues?.length){captureRecord=record;showSubtitle(record.value);}
  else if(record?.state==='running'){captureRecord=record;notice('擷取中…');}
   else if(record?.state==='failed'){captureRecord=record;showFailure(record.failureDetail || {code:record.failureCode});}
  updateSubtitleLabel();syncButtons();
}
function updateCaptureRecord(key,record){
   if(!record||record.version!==CAPTURE_VERSION||record.scope!==captureScopeValue||!key.startsWith(CAPTURE_PREFIX+tab?.id+':'))return;
  captureRecords=captureRecords.filter(item=>item.key!==key);captureRecords.push({key,...record});
  if(key!==currentCaptureKey)return;
  captureRecord=record;
   if(record.state==='complete'&&record.value?.cues?.length){showSubtitle(record.value);notice();hideFailure();}
   else if(record.state==='running'){subtitle=null;$('preview').value='';$('subtitleContent').hidden=true;notice('擷取中…');hideFailure();}
   else if(record.state==='failed'){subtitle=null;$('preview').value='';$('subtitleContent').hidden=true;showFailure(record.failureDetail || {code:record.failureCode});}
  updateSubtitleLabel();syncButtons();
}
async function refresh(force=false){
  const oldIdentity=page?page.url+'|'+page.media?.url+'|'+page.mediaIndex:'';
  stopBilibiliCaptionPolling();if(kind==='subtitle')preferredKindPending='subtitle';const token=++revision;page=null;info=null;tracks=[];subtitle=null;probePromise=null;captureScopeValue=null;captureRecords=[];captureRecord=null;currentCaptureKey=null;$('preview').value='';switchKind(kind==='subtitle'?'video':kind,false);applyInfo();
  notice();$('downloadSection').hidden=true;$('subtitleSection').hidden=true;$('sourceLabel').textContent='目前影片：';$('sourceLabel').classList.remove('error');$('pageTitle').hidden=false;$('pageTitle').textContent='讀取中…';$('mediaSelect').hidden=true;
  try{page=await send('snapshot',{tabId:tab.id,mediaIndex});}catch(e){if(token===revision)sourceState('未取得影片資訊',e.message);return;}
  if(token!==revision)return;mediaIndex=page.mediaIndex || 0;sourceState();
  $('mediaSelect').replaceChildren();for(const [i,v] of (page.videos || []).entries())$('mediaSelect').add(new Option(v.title,String(i)));$('mediaSelect').value=String(mediaIndex);$('mediaSelect').title=page.videos?.[mediaIndex]?.title || page.title;
  if(!page.videos?.length){addTracks();return;}
  if(oldIdentity!==page.url+'|'+page.media?.url+'|'+page.mediaIndex)chosenTrackId=null;
  captureScopeValue=await makeCaptureScope(tab.id,page,mediaIndex);const all=await chrome.storage.session.get(null),prefix=CAPTURE_PREFIX+tab.id+':';captureRecords=Object.entries(all).filter(([key,record])=>key.startsWith(prefix)&&record?.version===CAPTURE_VERSION&&record.scope===captureScopeValue).map(([key,record])=>({key,...record}));
  const latest=[...captureRecords].filter(item=>['complete','running','failed'].includes(item.state)).sort((a,b)=>(b.finishedAt||b.startedAt||0)-(a.finishedAt||a.startedAt||0))[0];if(!chosenTrackId&&latest?.track?.trackId)chosenTrackId=latest.track.trackId;
  addTracks();await restoreSelectedCapture(token);
  if(page.platform?.site==='bilibili'&&!tracks.length){if(page.captionFailure)showFailure(page.captionFailure);else startBilibiliCaptionPolling(token);}
  probePromise=Promise.resolve().then(()=>inspect(token,force));addTracks();void probePromise;
}
bind('videoTab',()=>switchKind('video'));bind('audioTab',()=>switchKind('audio'));bind('subtitleTab',()=>switchKind('subtitle'));
for(const id of ['videoFormat','audioFormat','height','audioQuality','subtitleFormat'])$(id).addEventListener('change',()=>{void savePreference(id,$(id).value);if(['videoFormat','audioFormat'].includes(id))updateQuality();else updateDownloadLabel();if(id==='subtitleFormat')updatePreview();});
$('language').addEventListener('change',()=>{chosenTrackId=$('language').value;void restoreSelectedCapture();$('language').title=$('language').selectedOptions[0]?.textContent || '';});
$('mediaSelect').addEventListener('change',()=>{mediaIndex=Number($('mediaSelect').value);refresh().catch(e=>notice(e.message,true));});
bind('refresh',()=>refresh(true));
bind('download',async()=>{const cap=selectedCapability();if(!cap?.enabled)throw new Error('請先讀取來源資訊');notice();const title=[page.videos?.[mediaIndex]?.title,info.title,page.title].map(value=>String(value || '').trim()).find(value=>value&&!/^影片\s*\d+$/i.test(value)) || '',key=kind==='video'?$('height').value:$('audioQuality').value,ext=cap.extensions[key],message={sourceId:info.browserSourceId,downloadKey:info.downloadKey,title,platform:page.platform?.site,kind,height:Number($('height').value),audioQuality:$('audioQuality').value};
 if(typeof showSaveFilePicker==='function'){const name=suggestedFilename(title,ext,usedFilenames),destinationId=crypto.randomUUID(),reservation=send('prepareDownload',{...message,destinationId});
  try{const handle=await showSaveFilePicker({suggestedName:name});const result=await reservation;if(result?.duplicate)return;usedFilenames=filenameHistory([...usedFilenames,handle.name]);void send('rememberFilename',{name:handle.name}).catch(()=>{});VideoPocketDestinations.putNow(handle,destinationId);}catch(error){const job=await reservation.catch(()=>null);if(job?.id&&!job.duplicate)await send('cancel',{id:job.id});throw error;}
 }else await send('download',message);await renderJob();});

bind('loadSubtitle',async()=>{
  let chosen=selectedTrack();if(!chosen&&probePromise){await probePromise;chosen=selectedTrack();}if(!chosen)throw new Error('此影片沒有可讀取的原始字幕');
   const scope=captureScopeValue || await makeCaptureScope(tab.id,page,mediaIndex),key=await makeCaptureKey(tab.id,scope,chosen),selector={videoId:page.platform?.id,pageSource:chosen.pageSource,pageTrackId:chosen.pageTrackId,pageTrackIndex:chosen.pageTrackIndex,captionName:chosen.captionName,apiTrackId:chosen.apiTrackId,rawLanguage:chosen.rawLanguage,trackName:chosen.name,mediaUrl:page.media?.url,mediaKey:page.media?.mediaKey,frameId:page.frameId,documentId:page.documentId,localMediaIndex:page.localMediaIndex};
   if(chosen.pageSource==='bilibili-api')Object.assign(selector,{expectedBvid:chosen.bvid,expectedCid:chosen.cid,expectedPage:chosen.page,explicitPage:chosen.explicitPage,duration:page.platform?.duration || page.media?.duration});
   currentCaptureKey=key;captureRecord={state:'running'};subtitle=null;$('preview').value='';$('subtitleContent').hidden=true;hideFailure();updateSubtitleLabel();syncButtons();notice('擷取中…');
  const value=await send('captureSubtitle',{key,scope,tabId:tab.id,documentId:page.documentId,mediaIndex,platform:page.platform?.site,language:chosen.pageLanguage || chosen.language,automatic:chosen.automatic,selector,sourceId:info?.browserSourceId,index:chosen.pageTrackIndex,track:chosen});
  if(currentCaptureKey===key){captureRecord={state:'complete',value};showSubtitle(value);notice();}
});
bind('copy',async()=>{await navigator.clipboard.writeText(exportSubtitle(subtitle,$('subtitleFormat').value).content);notice('已複製');});
bind('saveSubtitle',async()=>{const {format,content}=exportSubtitle(subtitle,$('subtitleFormat').value);const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));setTimeout(()=>URL.revokeObjectURL(url),60000);await chrome.downloads.download({url,filename:suggestedFilename(page.videos?.[mediaIndex]?.title || page.title,format),saveAs:true,conflictAction:'uniquify'});notice();});
function hideFailure(){clearTimeout(errorTimer);$('diagnosticRow').hidden=true;currentErrorId=null;}
function showFailure(error,id=null,remaining=ERROR_VISIBILITY_MS){const value=briefFailure(error);if(!value)return;clearTimeout(errorTimer);currentErrorId=id;$('diagnosticText').textContent=`診斷：${value.message}（${value.code}）`;$('diagnosticText').title=$('diagnosticText').textContent;$('diagnosticRow').hidden=false;errorTimer=setTimeout(hideFailure,remaining);}
async function renderDiagnostics(){const value=await send('lastError');if(!visibleFailure(value)){if(captureRecord?.state!=='failed')hideFailure();return;}showFailure(value,value.id,Math.max(1,ERROR_VISIBILITY_MS-(Date.now()-value.time)));}
$('dismissError').addEventListener('click',()=>{const id=currentErrorId;hideFailure();void send('dismissError',{id}).catch(()=>{});});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[FILENAME_HISTORY_KEY])usedFilenames=filenameHistory(changes[FILENAME_HISTORY_KEY].newValue);if(area==='session'&&changes.jobs){void renderJob();syncButtons();}if(area==='session'&&changes.lastError)void renderDiagnostics();for(const [key,change] of Object.entries(changes))if(area==='session'&&key.startsWith(CAPTURE_PREFIX+tab?.id+':'))updateCaptureRecord(key,change.newValue);});

async function init(){await VideoPocketDestinations.ready();const stored=await chrome.storage.local.get(['downloadPreferences',FILENAME_HISTORY_KEY]);const session=await chrome.storage.session.get('jobs');sessionJobs=session.jobs || [];usedFilenames=filenameHistory(stored[FILENAME_HISTORY_KEY]);preferences=normalizePreferences(stored.downloadPreferences);$('subtitleFormat').value=preferences.subtitleFormat;switchKind(preferences.kind,false);[tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id)throw new Error('請先開啟影片網頁');syncButtons();await refresh();await renderJob();await renderDiagnostics();}
init().catch(e=>{notice();sourceState('未取得影片資訊',e.message);});



