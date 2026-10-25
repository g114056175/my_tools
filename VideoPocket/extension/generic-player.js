// Serialized into MAIN only after the old route has failed on an unknown site.
// All helpers are local: no observer hooks, model/cache writes, eval, setup,
// playback changes, global-object walks, page-wide iframe scans or persistence.
export function genericPlayerSnapshot({mediaKey,pageUrl,binding:expected,mode}={}){
 const own=(o,k)=>{try{const d=Object.getOwnPropertyDescriptor(o,k);return d&&'value'in d?d.value:undefined;}catch{return undefined;}};
 const attr=(o,k)=>{try{return o?.getAttribute?.(k) || '';}catch{return '';}};
 const list=(root,selector)=>{try{return [...root.querySelectorAll(selector)].slice(0,256);}catch{return [];}};
 const clock=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
 const started=clock(),within=()=>clock()-started<60;
 // JSON.parse may be wrapped by the old observer. A bounded JSON reader keeps
 // this fallback's data out of that observer's model pool and parsing budget.
 const parse=text=>{
  let i=0,nodes=0;
  const space=()=>{while(/\s/.test(text[i] || '')&&i<text.length)i++;};
  const string=()=>{
   if(text[i++]!=='"')throw 0;let out='';
   while(i<text.length){
    if(i%1024===0&&!within())throw 0;
    const c=text[i++];if(c==='"')return out;
    if(c==='\\'){
     const e=text[i++],esc={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
     if(e==='u'){const h=text.slice(i,i+4);if(!/^[0-9a-f]{4}$/i.test(h))throw 0;out+=String.fromCharCode(parseInt(h,16));i+=4;}
     else if(Object.prototype.hasOwnProperty.call(esc,e))out+=esc[e];else throw 0;
    }else {if(c<' ')throw 0;out+=c;}
   }throw 0;
  };
  const value=depth=>{
   if(depth>16||++nodes>4096||!within())throw 0;space();const c=text[i];
   if(c==='"')return string();
   if(c==='{'||c==='['){
    const object=c==='{',result=object?Object.create(null):[];i++;space();
    const close=object?'}':']';if(text[i]===close){i++;return result;}
    for(let count=0;count<256;count++){
     space();let key;if(object){key=string();space();if(text[i++]!==':')throw 0;}
     const item=value(depth+1);if(object)result[key]=item;else result.push(item);
     space();if(text[i]===close){i++;return result;}if(text[i++]!==',')throw 0;
    }throw 0;
   }
   for(const [token,result] of [['true',true],['false',false],['null',null]])if(text.startsWith(token,i)){i+=token.length;return result;}
   const match=text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!match)throw 0;
   i+=match[0].length;const n=Number(match[0]);if(!Number.isFinite(n))throw 0;return n;
  };
  const result=value(0);space();if(i!==text.length)throw 0;return result;
 };
 if(location.href!==pageUrl)return {valid:false};
 const keys=window[Symbol.for('video-pocket.identities')]?.keys;
 if(!keys)return {valid:false};
 const registered=window[Symbol.for('video-pocket.mediaObserver')]?.videosSnapshot?.(256) || [];
 const videos=[...new Set([...registered,...list(document,'video')])].slice(0,256);
 const selected=videos.filter(video=>keys.get(video)===mediaKey);
 if(selected.length!==1)return {valid:false};
 const video=selected[0];
 if(video.isConnected===false||video.mediaKeys)return {valid:false};
 const contains=(node,target)=>{for(let v=target,n=0;v&&n<8;n++){try{if(node===v||node?.contains?.(v))return true;const host=v.getRootNode?.()?.host;if(!host||host===v)break;v=host;}catch{break;}}return false;};
 const uniqueContainer=node=>node&&contains(node,video)&&new Set([...videos.filter(v=>contains(node,v)),...list(node,'video')]).size===1;
 const source=String(video.currentSrc||attr(video,'src')||'');
 if(source.length>16384)return {valid:false};
 const http=raw=>{if(typeof raw!=='string'||raw.length>4096)return '';try{const u=new URL(raw,location.href);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const kindOf=(url,type='')=>/mpegurl|\bm3u8\b/i.test(type)||/\.m3u8(?:[?#]|$)/i.test(url)?'hls':/dash\+xml|\bmpd\b/i.test(type)||/\.mpd(?:[?#]|$)/i.test(url)?'dash':/^(?:video|audio)\//i.test(type)||/\.(?:mp4|m4v|webm|mov)(?:[?#]|$)/i.test(url)?'progressive':'';
 const read=(o,key)=>{try{return typeof o?.[key]==='function'?o[key]():undefined;}catch{return undefined;}};
 const at=(o,path)=>path.split('.').reduce((value,key)=>own(value,key),o);
 const candidates=[];let parser='',modelId='',mediaTitle='';
 const itemTitle=item=>{const value=own(item,'title')||own(item,'name');return typeof value==='string'&&value.length<=4096?value.replace(/\s+/g,' ').trim():'';};
 const add=(raw,type='')=>{const url=http(raw),kind=kindOf(url,type);if(url&&/^video\/(?:youtube|twitch|dailymotion)$/i.test(type)){if(!candidates.some(v=>v.embedUrl===url)&&candidates.length<6)candidates.push({embedUrl:url});}else if(url&&kind&&!candidates.some(v=>v.url===url)&&candidates.length<6)candidates.push({url,kind});};
 const itemSources=item=>{
  if(!item||typeof item!=='object')return;
  if(own(item,'drm')||own(item,'keySystems')||own(item,'contentProtection'))return;
  add(own(item,'file')||own(item,'src')||own(item,'contentUrl'),own(item,'type')||own(item,'mimeType')||'');
  const sources=own(item,'sources');
  if(Array.isArray(sources))for(const value of sources.slice(0,16)){
   if(!within())break;
   if(typeof value==='string')add(value);
   else if(value&&!own(value,'drm')&&!own(value,'keySystems'))add(own(value,'file')||own(value,'src')||own(value,'url'),own(value,'type')||'');
  }
  const embedUrl=http(own(item,'embedUrl'));
  if(embedUrl&&!candidates.length)candidates.push({embedUrl});
 };

 // Registered JW Player: query only an already rendered, uniquely owned
 // container by its exact ID, and accept only its CURRENT playlist item.
 let wrapper;try{wrapper=video.closest?.('.jwplayer');}catch{}
 const jwId=attr(wrapper,'id');
 if(uniqueContainer(wrapper)&&jwId&&jwId.length<=160&&typeof window.jwplayer==='function'&&within()){
  try{
   const player=window.jwplayer(jwId);
   if(read(player,'getContainer')===wrapper){
    let item=read(player,'getPlaylistItem');
    if(!item){const items=read(player,'getPlaylist'),index=read(player,'getPlaylistIndex');if(Array.isArray(items)&&Number.isInteger(index)&&index>=0&&index<items.length)item=items[index];}
    itemSources(item);
    if(candidates.length){parser='jwplayer';mediaTitle=itemTitle(item);const id=own(item,'mediaid')||own(item,'id');modelId=['string','number'].includes(typeof id)?String(id).slice(0,256):'';}
   }
  }catch{}
 }

 // Video.js lookup never calls videojs(id), which could create a player.
 if(!candidates.length&&mode!=='early'&&within()){
  const instances=[];
  for(const node of [video,video.parentElement])for(const key of ['player','videojsPlayer','__videojsPlayer']){const p=own(node,key);if(p&&!instances.includes(p))instances.push(p);}
  try{const values=window.videojs?.getAllPlayers?.() || Object.values(window.videojs?.getPlayers?.() || {});for(const p of values.slice(0,32))if(!instances.includes(p))instances.push(p);}catch{}
  for(const player of instances.slice(0,32)){
   if(!within())break;
   const el=read(player,'el');if(!uniqueContainer(el))continue;
   let tech=own(player,'tech_');try{if(typeof tech==='function')tech=tech.call(player);}catch{tech=null;}
   const techEl=read(tech,'el')||own(tech,'el_');if(techEl&&techEl!==video)continue;
   const vhs=own(tech,'vhs'),active=['source_.src','source_.uri','source_.resolvedUri','playlists.main.uri','playlists.master.uri','playlistController_.mainPlaylistLoader_.main.uri','playlist.uri'].map(path=>http(at(vhs,path))).find(Boolean);
   // The live transport source outranks a welcome/ad entry left in the
   // public currentSources cache. Its master supplies the quality list.
   if(active)itemSources({src:active,type:/\.m3u8(?:[?#]|$)/i.test(active)?'application/x-mpegURL':''});
   else{
    itemSources(read(player,'currentSource'));
    const values=read(player,'currentSources');if(Array.isArray(values))itemSources({sources:values});
    if(!candidates.length)itemSources(own(player,'options_'));
   }
   if(candidates.length){parser='videojs';modelId=attr(el,'id').slice(0,256);break;}
  }
 }

 // Element-owned data-setup is configuration, never executable script text.
 if(!candidates.length&&mode!=='early'&&within()){
  const raw=attr(video,'data-setup');
  if(raw&&raw.length<=65536)try{itemSources(parse(raw));if(candidates.length){parser='data-setup';modelId=attr(video,'id').slice(0,256);}}catch{}
 }

 // A scoped VideoObject, or an exact element/fragment ID in a JSON-LD graph.
 // Multiple unmatched objects and page-level titles are not media identities.
 if(mode==='early'&&!candidates.length){
  let existing=false;try{existing=!!video.closest?.('.video-js,video-js');}catch{}
  for(const node of [video,video.parentElement])for(const key of ['player','videojsPlayer','__videojsPlayer'])if(own(node,key))existing=true;
  for(const key of ['hls','player'])if(own(own(window,key),'media')===video)existing=true;
  if(existing)return {valid:false};
 }
 if(!candidates.length&&within()){
  let scope;try{scope=video.closest?.('figure,.video-js,[data-video-id],[data-media-id]');}catch{}
  if(!uniqueContainer(scope))scope=video;
  const ids=new Set([attr(video,'id'),attr(video,'data-video-id'),attr(scope,'id'),attr(scope,'data-video-id'),attr(scope,'data-media-id')].filter(Boolean));
  const scripts=[...new Set([...list(scope,'script[type="application/ld+json"]'),...(mode==='early'?[]:list(document,'script[type="application/ld+json"]'))])].slice(0,16);
  const matched=[];let total=0;
  for(const script of scripts){
   if(!within())break;
   const raw=script.textContent || '';if(raw.length>131072||total+raw.length>262144)continue;total+=raw.length;
   let data;try{data=parse(raw);}catch{continue;}
   const objects=[];const walk=(value,depth=0)=>{if(!value||depth>5||objects.length>=64||!within())return;if(Array.isArray(value)){for(const v of value.slice(0,64))walk(v,depth+1);}else if(typeof value==='object'){if(value['@type']==='VideoObject'||Array.isArray(value['@type'])&&value['@type'].includes('VideoObject'))objects.push(value);if(value['@graph'])walk(value['@graph'],depth+1);}};
   walk(data);
   for(const item of objects){
    const names=[item.identifier,item['@id']].filter(v=>typeof v==='string');
    const exact=names.some(name=>ids.has(name)||name.startsWith('#')&&ids.has(name.slice(1))||(()=>{try{const u=new URL(name,location.href),p=new URL(location.href);return u.origin===p.origin&&u.pathname===p.pathname&&u.search===p.search&&ids.has(u.hash.slice(1));}catch{return false;}})());
    if(exact||contains(scope,script)&&objects.length===1)matched.push(item);
   }
  }
  if(matched.length===1){itemSources(matched[0]);if(candidates.length){parser='json-ld';mediaTitle=itemTitle(matched[0]);modelId=String(matched[0]['@id']||matched[0].identifier||'').slice(0,256);}}
 }
 if(!candidates.length||!within())return {valid:false};
 const fingerprint=JSON.stringify([parser,modelId,candidates]);
 const duration=Number(video.duration),binding={mediaKey,pageUrl:location.href,source,fingerprint,...(Number.isFinite(duration)&&duration>0?{duration}:{})};
 const valid=!expected||expected.mediaKey===mediaKey&&expected.pageUrl===binding.pageUrl&&expected.source===source&&expected.fingerprint===fingerprint&&(!expected.duration||Number.isFinite(duration)&&Math.abs(expected.duration-duration)<.1);
 return expected?{valid}:{valid:true,binding,candidates,duration:Number(video.duration),parser,...(mediaTitle?{metadata:{title:mediaTitle}}:{})};
}
