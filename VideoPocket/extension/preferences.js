export const DEFAULT_PREFERENCES={kind:'video',videoFormat:'auto',height:'0',audioFormat:'original',audioQuality:'best',subtitleFormat:'txt'};
export function normalizePreferences(value={}){
  const result={...DEFAULT_PREFERENCES};
  for(const [key,allowed] of Object.entries({kind:['video','audio','subtitle'],videoFormat:['auto','mp4','mkv'],audioFormat:['original','mp3','m4a'],audioQuality:['best','128','192','320'],subtitleFormat:['txt','srt','vtt','plain']}))if(allowed.includes(value[key]))result[key]=value[key];
  if(/^\d{1,5}$/.test(String(value.audioQuality)))result.audioQuality=String(value.audioQuality);
  if(/^\d{1,5}$/.test(String(value.height)))result.height=String(value.height);
  return result;
}
// A temporary fallback never replaces the user's stored preference.
export function availableQuality(preferred,values,fallback){
  if(values.includes(String(preferred)))return String(preferred);
  const lower=values.filter(v=>Number(v)>0&&Number(v)<=Number(preferred)).sort((a,b)=>Number(b)-Number(a));
  return lower[0] || fallback;
}

// This value exists only in the popup. It must never become a saved preference
// or a transport height; it represents this source's automatic adjustment.
export const PRESERVED_QUALITY='preferred';
function availableVideoQuality(preferred,values){
 const selected=availableQuality(String(preferred),['0',...values],'0');
 return selected==='0'&&Number(preferred)>0&&values.length?String(Math.min(...values.map(Number))):selected;
}
export function videoQualityOptions(preferred,heights=[]){
 const values=[...new Set(heights.map(Number).filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>b-a).map(String),wanted=String(preferred),effective=availableVideoQuality(wanted,values);
 const automatic=Number(wanted)>0&&!values.includes(wanted)&&values.length>0;
 if(values.length===1&&!automatic)return {options:[{value:values[0],label:`${values[0]}p`}],selected:values[0]};
 const options=[{value:'0',label:values.length?`Best (${values[0]}p)`:'Best'}];
 if(automatic)options.push({value:PRESERVED_QUALITY,label:`${effective}p (Auto)`,title:`Preferred ${wanted}p; using ${effective}p for this video`});
 options.push(...values.map(value=>({value,label:`${value}p`})));
 return {options,selected:automatic?PRESERVED_QUALITY:effective};
}
export function resolvedVideoQuality(value,preferred,heights=[]){
 return value===PRESERVED_QUALITY?availableVideoQuality(preferred,heights.map(String)):String(Number(value)||0);
}

