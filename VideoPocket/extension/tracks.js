export function locale(code){return String(code || 'und').replace(/-orig$/i,'').replace(/_/g,'-').toLowerCase();}
export function parameters(raw){
  try{const u=new URL(raw.url),encoded=u.pathname.match(/\/tts_params\/([^/]+)/)?.[1];return encoded?new URLSearchParams(decodeURIComponent(encoded)):u.searchParams;}catch{return new URLSearchParams();}
}
export function translated(track){
  if(track.translated || track.isTranslated)return true;
  const p=parameters(track),target=p.get('tlang'),source=p.get('lang');return !!target && locale(target)!==locale(source);
}
export function trackIdentity(raw){
  const p=parameters(raw),language=locale(p.get('lang') || raw.language);let variant;
  // yt-dlp may expose the same ASR track in several formats/clients/HLS URLs.
  // There is one original speech-recognition choice per source language.
  if(raw.automatic&&raw.source!=='bilibili-api')return `${language}|true|original-asr`;
  if(raw.source==='bilibili-api')return `${language}|${!!raw.automatic}|bili:${raw.bvid}:${raw.cid}:${raw.pageTrackId}`;
  let subtitleFile=false;try{subtitleFile=/\.(vtt|srt|json3|json)$/i.test(new URL(raw.url).pathname);}catch{}
  if(p.has('lang')&&!subtitleFile){
    const sourceLanguage=p.get('lang'),vss=String(raw.vssId || '').replace(/^a?\./,'');
    const suffix=vss.startsWith(sourceLanguage+'.')?vss.slice(sourceLanguage.length+1):String(raw.nativeLanguage || '').startsWith(sourceLanguage+'-')?raw.nativeLanguage.slice(sourceLanguage.length+1).replace(/^orig$/,''):'';
    variant='name:'+(p.get('name') || raw.captionName || suffix);
  }
  else if(raw.vssId)variant='vss:'+raw.vssId;
  else{try{const u=new URL(raw.url);u.searchParams.delete('fmt');if(subtitleFile){u.searchParams.delete('lang');u.searchParams.delete('tlang');}variant='url:'+u.origin+u.pathname.replace(/\.(vtt|srt|json3|srv[123]|ttml)$/i,'')+u.search;}catch{variant='label:'+(raw.captionName || raw.name || '').replace(/\s*\(Original\)\s*$/i,'');}}
  return `${language}|${!!raw.automatic}|${encodeURIComponent(variant)}`;
}
export function originalTracks(tracks){
  const result=new Map();
  for(const raw of tracks || []){
    if(translated(raw) || raw.language==='live_chat')continue;
    const id=raw.trackId || trackIdentity(raw),language=locale(parameters(raw).get('lang') || raw.language);
    const track=result.get(id) || {trackId:id,language,name:raw.name || raw.language,automatic:!!raw.automatic,custom:customTrack(raw)};
    if(raw.source==='native'){
      const nativeLanguage=raw.nativeLanguage || raw.language;
      if(!track.nativeLanguage || /-orig$/.test(nativeLanguage))track.nativeLanguage=nativeLanguage;
    }else if(raw.source){
      track.pageSource=raw.source;track.pageLanguage=raw.language;track.pageTrackId=raw.pageTrackId;track.pageTrackIndex=raw.pageTrackIndex;track.captionName=raw.captionName;
      track.name=raw.name || track.name;
      if(raw.source==='bilibili-api'){track.bvid=raw.bvid;track.cid=Number(raw.cid)||0;track.page=Number(raw.page)||1;track.explicitPage=!!raw.explicitPage;track.apiTrackId=raw.apiTrackId===undefined?'':String(raw.apiTrackId);track.rawLanguage=raw.rawLanguage || raw.language;}
    }
    track.active ||= !!raw.active;track.default ||= !!raw.default;
    track.name=String(track.name || language);if(!track.pageSource)track.name=track.name.replace(/\s*\(Original\)\s*$/i,'');result.set(id,track);
  }
  return [...result.values()];
}
export function orderTracks(tracks,preferences=[]){
  const languages=[...new Set(preferences.filter(Boolean).map(locale))];
  const primary=languages[0] || 'en',family=s=>s.split('-')[0],traditional=s=>/hant|tw|hk|mo/.test(s),mainstream=['en','ja','es','fr','de','ko'];
  const score=t=>{
    const lang=locale(t.language),base=family(lang);let rank=10000;
    if(base===family(primary)){const region=s=>s.match(/(?:^|-)(tw|hk|mo|cn|sg)(?:-|$)/)?.[1];rank=lang===primary?0:base==='zh'?region(primary)&&region(primary)===region(lang)?1:traditional(lang)===traditional(primary)?(/hant|hans/.test(lang)&&!region(lang)?20:40):100:50;}
    else if(base==='en')rank=1000;
    else{const preferred=languages.findIndex(p=>family(p)===base),common=mainstream.indexOf(base);rank=preferred>=0?2000+preferred*100:common>=0?4000+common*100:10000;}
    // User locale and English outweigh player choices and effect variants.
    // Active/default only break ties within a language; popup choices persist.
    return rank+(t.custom?100000:0)+(t.automatic?20:0)+(t.default?0:2)+(t.active?0:1);
  };
  return [...tracks].sort((a,b)=>score(a)-score(b));
}
export function selectTrack(tracks,preferences=[]){return orderTracks(tracks,preferences)[0] || null;}
export function customTrack(raw){
  const name=String(raw.name || '');
  if(/\b(rgb|kanji|romaji|karaoke|v\d+)\b|\[(pc|mobile)\]|彩色|特效|卡拉|花字/i.test(name))return true;
  return /\s[-–~]\s/.test(name)&&!raw.automatic;
}
export function mergeTracks(page,native=[]){
  const existing=originalTracks(page?.tracks || []),ids=new Set(existing.map(t=>t.trackId));
  // Caption inventory is authoritative for the selected YouTube player. HLS
  // candidates falsely classified as ASR by another client must not add tracks.
  const candidates=page?.platform?.site==='bilibili'?[]:page?.captionInventory?native.filter(t=>ids.has(t.trackId || trackIdentity(t))):native;
  return originalTracks([...(page?.tracks || []),...candidates]);
}
export function trackLabel(track,uiLanguage='en'){
  const language=locale(track.language),name=String(track.name||''),withoutAuto=name.replace(/\s*[（(](?:自動產生|自动生成|自動生成|auto.generated)[）)]/gi,'').trim();
  let displayName=language;
  try{displayName=new Intl.DisplayNames([uiLanguage],{type:'language'}).of(language)||language;}catch{}
  const localizedNames=new Set();
  for(const localeName of new Set([uiLanguage,language,'zh-Hant','zh-Hans']))try{const label=new Intl.DisplayNames([localeName],{type:'language'}).of(language);if(label)localizedNames.add(label);}catch{}
  const isLanguageName=localizedNames.has(withoutAuto);
  let label=!name||locale(name)===language||isLanguageName||withoutAuto!==name?displayName:name;
  return track.automatic?`${label} · Speech recognition`:label;
}
