import {selectedPlan,qualityOfFormat} from './browser-media.js';

const changed=()=>Object.assign(new Error('來源或所選影音格式已變更，請重新整理'),{code:'SOURCE_CHANGED'});
const trackIdentity=format=>format?{
 kind:format.kind || '',videoCodec:format.videoCodec || '',audioCodec:format.audioCodec || '',
 ext:format.ext || '',width:Number(format.width)||0,height:Number(format.height)||0,
 quality:qualityOfFormat(format),fps:Number(format.fps || format.frameRate)||0,
 bitrate:Number(format.bitrate)||0,audioBitrate:Number(format.audioBitrate)||0,
 itag:format.itag==null?'':String(format.itag),audioTrackId:format.audioTrackId || '',
 language:format.language || format.lang || '',audioGroup:format.audioGroup || '',
 channels:Number(format.audioChannels || format.channels)||0,
 filesize:Number(format.filesize)||0,
}:null;

// A refreshed URL is used only after throwing away the failed attempt. Never
// splice unverified old bytes into a resource returned by a new inspection.
export function validateMediaRecovery(previous,next,selection){
 if(!previous||!next||previous===next)throw changed();
 const old=previous.descriptor || {},fresh=next.descriptor || {};
 if(!Number.isInteger(old.tabId)||!old.documentId||old.mediaKey==null||
   old.tabId!==fresh.tabId||old.documentId!==fresh.documentId||
   String(old.mediaKey)!==String(fresh.mediaKey)||Number(old.frameId || 0)!==Number(fresh.frameId || 0))throw changed();
 const duration=Number(previous.duration),freshDuration=Number(next.duration);
 if(!(duration>0&&freshDuration>0)||!Number.isFinite(duration)||!Number.isFinite(freshDuration)||
   Math.abs(duration-freshDuration)>Math.max(.25,duration*.001))throw changed();
 let before,after;
 try{before=selectedPlan(previous.capability,selection);after=selectedPlan(next.capability,selection);}catch{throw changed();}
 if(before.ext!==after.ext||!!previous.sabr!==!!next.sabr||
   JSON.stringify(trackIdentity(before.video))!==JSON.stringify(trackIdentity(after.video))||
   JSON.stringify(trackIdentity(before.audio))!==JSON.stringify(trackIdentity(after.audio)))throw changed();
 if(selection.range&&(selection.range.start<0||selection.range.end>freshDuration||selection.range.start>=selection.range.end||!next.range?.supported))throw changed();
 return {};
}
