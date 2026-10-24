import { isGenericMediaTitle } from './media-titles.js';
import {saveFailureDetails} from './diagnostics.js';
import {BUILD_ID} from './build-info.js';

const enabledChoices = choices => Object.values(choices || {}).some(choice => choice?.enabled);

// Single-title headers use CSS ellipsis. Native select options need a measured
// label because their open menu otherwise expands to the longest full title.
export function mediaTitleLabel(title,maxWidth=Infinity,measure) {
  const text=String(title || '').replace(/\s+/g,' ').trim();
  if(typeof measure!=='function'||!Number.isFinite(maxWidth)||measure(text)<=maxWidth)return text;
  const suffix='…';
  if(measure(suffix)>maxWidth)return '';
  const characters=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(part=>part.segment);
  let low=0,high=characters.length;
  while(low<high){const middle=Math.ceil((low+high)/2);if(measure(characters.slice(0,middle).join('')+suffix)<=maxWidth)low=middle;else high=middle-1;}
  return characters.slice(0,low).join('').trimEnd()+suffix;
}

export function orderedMediaOptions(videos=[]){
 return videos.map((video,index)=>({index,title:String(video.title || '').trim() || `影片 ${index+1}`}))
   .sort((a,b)=>Number(isGenericMediaTitle(a.title))-Number(isGenericMediaTitle(b.title)));
}

export function mediaAvailability(info) {
  return {
    video: enabledChoices(info?.choices?.video),
    audio: enabledChoices(info?.choices?.audio),
  };
}

export function popupAvailability(info, tracks = []) {
  const media = mediaAvailability(info);
  return {...media, subtitle: tracks.length > 0, any: media.video || media.audio || tracks.length > 0};
}

export function restoredKind(kind, available) {
  if (available[kind]) return kind;
  if (available.video) return 'video';
  if (available.audio) return 'audio';
  if (available.subtitle) return 'subtitle';
  return 'video';
}

export function sourceVisibility({info, tracks = [], kind}) {
  const available = popupAvailability(info, tracks);
  return {
    available,
    showDownloadSection: available.any,
    showSubtitleSection: available.subtitle && kind === 'subtitle',
    showVideoSettings: available.video && kind === 'video',
    showAudioSettings: available.audio && kind === 'audio',
  };
}

export function sourceHeader({hasVideo,info,tracks=[],phase='idle',error='',detail=''}) {
  if(error)return {label:error,detail,error:true};
  if(phase==='detecting')return {label:'讀取影片中…',detail:'正在檢查此分頁的影片',error:false};
  if(hasVideo&&phase==='inspecting')return {label:'解析影片中…',detail:'正在驗證下載來源',error:false};
  if(hasVideo&&!popupAvailability(info,tracks).any)return {label:'找到影片，但無下載來源',detail:detail || '未取得可下載的影音格式或字幕',error:true};
  return {label:'影片：',detail:'',error:false};
}

export async function sourceDeadline(operation,timeoutMs=30000) {
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('來源驗證逾時'),{code:'NETWORK_TIMEOUT'})),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

// A shareable diagnostic has no titles, post IDs, URLs, cookies or raw logs.
export function sourceInspectionDiagnostic({page,mediaIndex=0,phase,failure}={}){
 const selected=page?.videos?.[mediaIndex],d=page?.media?.discoveryDiagnostics || {},count=value=>Number.isInteger(value)&&value>=0?value:0;
 const result={schema:1,version:'1.0.0',build:BUILD_ID,phase:['detecting','inspecting','ready','failed'].includes(phase)?phase:'unknown',videoCount:count(page?.videos?.length),selectedIndex:count(mediaIndex)+1,hasPermalink:!!selected?.linkedMedia,hasDirectSource:!!selected?.downloadUrl,hasPlatform:!!page?.platform,discovery:{json:count(d.json?.observed),oversized:count(d.json?.oversized),throttled:count(d.json?.throttled),models:count(d.models),matches:count(d.matches),playerIds:count(d.playerIds),localNetworkCandidates:count(d.localNetworkCandidates),unboundFallbackBlocked:!!d.unboundFallbackBlocked}};
 if(typeof d.observerBuild==='string'&&/^[a-z0-9-]{1,64}$/.test(d.observerBuild))result.discovery.observerBuild=d.observerBuild;
 if(Number.isInteger(d.metadataQueue))result.discovery.metadataQueue=count(d.metadataQueue);
 if(['complete','item-budget','time-budget','metadata-budget','document-budget'].includes(d.explorationReason))result.discovery.exploration={reason:d.explorationReason,steps:count(d.count),elapsedMs:count(d.timingMs)};
 if(['incomplete-context','multiple-players','missing-duration','no-exact-binding'].includes(d.networkFallbackReason))result.discovery.networkFallbackReason=d.networkFallbackReason;
 if(['protected','explicit-identity','multiple-players','missing-duration','not-blob','no-live-metadata','too-many-candidates','stale-metadata','unknown-source-kind','verification-required'].includes(d.metadataReason)){
  result.discovery.metadataReason=d.metadataReason;result.discovery.metadataCandidates=count(d.metadataCandidates);
 }
 if(['no-model','no-player-identity','identity-unmatched','ambiguous-model','matched'].includes(d.reason))result.discovery.reason=d.reason;
 result.discovery.manifests=count(d.manifests);
 const site=page?.platform?.site;if(['youtube','bilibili','dailymotion','embedded','social-network','network-media','metadata-media','instagram','twitch','twitch-clip','anime1'].includes(site))result.platformKind=site;
 result.mainPlayer=!!(selected?.dailymotionMain||selected?.bilibiliMain);if(page?.bilibiliContext){result.bilibili={routeResolved:true,routeFallback:!!selected?.routeOnly,ownedPlayers:count(page.videos?.filter(v=>v.bilibiliMain&&!v.routeOnly).length)};}
 if(failure){result.failure={code:String(failure.code || '').match(/^[A-Z][A-Z0-9_]{0,48}$/)?.[0] || 'UNKNOWN',...saveFailureDetails(failure)};if(Number.isInteger(failure.httpStatus))result.failure.httpStatus=failure.httpStatus;
  if(Number.isInteger(failure.apiCode)&&Math.abs(failure.apiCode)<=1000000)result.failure.apiCode=failure.apiCode;
  if(['HEAD','GET','GET RANGE'].includes(failure.requestMethod))result.failure.method=failure.requestMethod;
  if(typeof failure.requestHost==='string'&&/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(failure.requestHost))result.failure.host=failure.requestHost;
  if(['selection-inventory','linked-document','linked-redirect','linked-ambiguous','linked-no-model','dailymotion-metadata','dailymotion-manifest','bilibili-playurl','source-request','source-head','source-probe','stream-manifest','stream-segment'].includes(failure.sourceStage))result.failure.stage=failure.sourceStage;
 }
 return result;
}
