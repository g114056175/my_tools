/* Pure policy for the opt-in "download the complete progressive file, then cut" path. */
const unsupported = (reason, extra = {}) => ({supported:false,mode:'unsupported',reason,estimatedInputBytes:null,sizeKnown:false,...extra});
const positiveFinite = value => Number.isFinite(Number(value)) && Number(value) > 0;
const exactSize = format => { const value=Number(format?.filesize); return Number.isSafeInteger(value)&&value>0?value:null; };
const sourceExts=new Set(['mp4','webm','mkv','ogg','mp3','m4a','ts']);
const outputExts=new Set(['mp4','m4a','webm','mkv','ogg','mp3']);
const videoCodecs=new Set(['h264','hevc','av1','vp9','vp8']);
const audioCodecs=new Set(['aac','opus','vorbis','mp3']);
export function fullCutPolicy(source, plan) {
  if(!positiveFinite(source?.duration))return unsupported('The full video duration is unavailable.');
  if(source?.sabr||source?.drm||source?.live||source?.isLive||source?.metadata?.drm)return unsupported('This source is not a usable progressive file.');
  const formats=[plan?.video,plan?.audio].filter(Boolean);if(!formats.length)return unsupported('The plan has no usable video or audio tracks.');
  if(formats.some(format=>!format.videoCodec&&!format.audioCodec))return unsupported('The source codecs have not been verified.');
  if(!outputExts.has(String(plan?.ext||'').toLowerCase()))return unsupported('The output container does not support range cuts.');
  let estimatedInputBytes=0,knownInputBytes=0,hasUnknown=false;
  for(const format of formats){let url;try{url=new URL(String(format.url||''));}catch{return unsupported('The source URL is invalid.');}if(!/^https?:$/.test(url.protocol))return unsupported('The source is not an HTTP progressive file.');const ext=String(format.ext||'').toLowerCase();if(ext&&!sourceExts.has(ext))return unsupported('The source container does not support range cuts.');if(format.videoCodec&&!videoCodecs.has(String(format.videoCodec).toLowerCase())||format.audioCodec&&!audioCodecs.has(String(format.audioCodec).toLowerCase()))return unsupported('The source codec does not support range cuts.');if(format.drm||format.metadata?.drm||format.segments?.length||format.indexRange||format.mp4Index)return unsupported('The source is segmented or indexed. Use the partial range path.');const size=exactSize(format);if(size!=null){knownInputBytes+=size;estimatedInputBytes+=size;}else hasUnknown=true;}
  if(hasUnknown){const estimate=Number(plan?.size?.bytes);estimatedInputBytes=Number.isFinite(estimate)&&estimate>0?Math.max(knownInputBytes,estimate):0;}
  return {supported:true,mode:'full-cut',reason:null,estimatedInputBytes:estimatedInputBytes||null,knownInputBytes:knownInputBytes||null,sizeKnown:!hasUnknown};
}
export const planFullCut = fullCutPolicy;
