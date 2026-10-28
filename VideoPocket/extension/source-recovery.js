import {genericPageUrl} from './generic-fallback.js';
const text=value=>typeof value==='string'||typeof value==='number'&&Number.isFinite(value)?String(value).trim():'';

export function sourceContentIdentity(value={}){
 for(const identity of [value.mediaContentId,value.linkedMedia?.id,value.mediaIdentity]){const normalized=text(identity);if(normalized)return normalized;}
 return '';
}

export function sourceRecoveryTarget(descriptor={}){
 const contentId=sourceContentIdentity(descriptor),selectionIdentity=text(descriptor.selectionIdentity);
 let known=false;try{const page=new URL(descriptor.referer);known=!!descriptor.platform?.site&&/^https?:$/.test(page.protocol)&&!page.username&&!page.password&&!genericPageUrl(page.href);}catch{}
 if(!known&&descriptor.recoveryIdentity!==true)return null;
 if(!Number.isInteger(descriptor.tabId)||!Number.isInteger(descriptor.frameId)||typeof descriptor.documentId!=='string'||!descriptor.documentId||descriptor.mediaKey==null||!contentId||!selectionIdentity)return null;
 return {frameId:descriptor.frameId,documentId:descriptor.documentId,mediaKey:descriptor.mediaKey,mediaContentId:contentId,selectionIdentity,requiresBound:!known};
}

export function isExpiredSourceAuth(error,stage){
 if(stage!=='download'||error?.code!=='HTTP_AUTH')return false;
 const status=Number(error.httpStatus ?? error.status ?? error.statusCode);
 return status===401||status===403;
}

export function matchesRecoverySelection(target,page){
 if(!target||!page||page.selectionExpired===true)return false;
 const video=page.videos?.[page.mediaIndex];
 if(target.requiresBound&&video?.recoveryIdentity!==true)return false;
 return !!video&&Number(video.frameId)===Number(target.frameId)&&String(video.documentId||'')===target.documentId&&String(video.mediaKey??'')===String(target.mediaKey)&&text(video.selectionIdentity)===target.selectionIdentity&&sourceContentIdentity(video)===target.mediaContentId;
}

export function refreshedSourceDescriptor(previous,page,target){
 if(!matchesRecoverySelection(target,page))throw Object.assign(new Error('目前選取的影片已變更，請重新選取'),{code:'SOURCE_CHANGED'});
 const video=page.videos[page.mediaIndex];
 return {
  ...previous,
  url:video.downloadUrl,
  sourceType:video.sourceType,
  referer:video.referer || page.url || previous.referer,
  title:video.title || page.title || previous.title,
  duration:page.media?.duration ?? previous.duration,
  drm:page.media?.drm ?? previous.drm,
  platform:page.platform,
  linkedMedia:video.linkedMedia,
  mediaKey:video.mediaKey,
  frameId:video.frameId,
  documentId:video.documentId,
  localMediaIndex:video.localMediaIndex,
  mediaIndex:page.mediaIndex,
  playerUrl:video.url,
  mediaContentId:video.mediaContentId,
  mediaIdentity:video.mediaIdentity,
  selectionIdentity:video.selectionIdentity,
  recoveryIdentity:video.recoveryIdentity===true,
 };
}
