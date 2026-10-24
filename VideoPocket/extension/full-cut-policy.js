/* Pure policy for the opt-in "download the complete progressive file, then cut" path. */
const unsupported = (reason, extra = {}) => ({supported:false,mode:'unsupported',reason,estimatedInputBytes:null,sizeKnown:false,...extra});
const positiveFinite = value => Number.isFinite(Number(value)) && Number(value) > 0;
const exactSize = format => { const value=Number(format?.filesize); return Number.isSafeInteger(value)&&value>0?value:null; };
const sourceExts=new Set(['mp4','webm','mkv','ogg','mp3','m4a','ts']);
const outputExts=new Set(['mp4','m4a','webm','mkv','ogg','mp3']);
const videoCodecs=new Set(['h264','hevc','av1','vp9','vp8']);
const audioCodecs=new Set(['aac','opus','vorbis','mp3']);
export function fullCutPolicy(source, plan) {
  if(!positiveFinite(source?.duration))return unsupported('尚未取得完整影片長度');
  if(source?.sabr||source?.drm||source?.live||source?.isLive||source?.metadata?.drm)return unsupported('此來源不是可用的 progressive 檔案');
  const formats=[plan?.video,plan?.audio].filter(Boolean);if(!formats.length)return unsupported('計畫沒有可用影音軌');
  if(formats.some(format=>!format.videoCodec&&!format.audioCodec))return unsupported('尚未確認來源編碼');
  if(!outputExts.has(String(plan?.ext||'').toLowerCase()))return unsupported('輸出容器不支援區間裁切');
  let estimatedInputBytes=0,knownInputBytes=0,hasUnknown=false;
  for(const format of formats){let url;try{url=new URL(String(format.url||''));}catch{return unsupported('來源網址無效');}if(!/^https?:$/.test(url.protocol))return unsupported('來源不是 HTTP progressive 檔案');const ext=String(format.ext||'').toLowerCase();if(ext&&!sourceExts.has(ext))return unsupported('來源容器不支援區間裁切');if(format.videoCodec&&!videoCodecs.has(String(format.videoCodec).toLowerCase())||format.audioCodec&&!audioCodecs.has(String(format.audioCodec).toLowerCase()))return unsupported('來源編碼不支援區間裁切');if(format.drm||format.metadata?.drm||format.segments?.length||format.indexRange||format.mp4Index)return unsupported('來源已有分段或索引，應使用 partial range 路徑');const size=exactSize(format);if(size!=null){knownInputBytes+=size;estimatedInputBytes+=size;}else hasUnknown=true;}
  if(hasUnknown){const estimate=Number(plan?.size?.bytes);estimatedInputBytes=Number.isFinite(estimate)&&estimate>0?Math.max(knownInputBytes,estimate):0;}
  return {supported:true,mode:'full-cut',reason:null,estimatedInputBytes:estimatedInputBytes||null,knownInputBytes:knownInputBytes||null,sizeKnown:!hasUnknown};
}
export const planFullCut = fullCutPolicy;
