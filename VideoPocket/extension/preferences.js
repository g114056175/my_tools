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

