// Twitch Clips adapter. Reads only a bounded owner chain of the selected player.
const CLIENT_ID='kimne78kx3ncx6brgo4mv6wki5h1ko';
const CLIP_QUERY=`query Clip($slug: String!) { clip(slug: $slug) { id slug title durationSeconds playbackAccessToken { value signature } videoQualities { quality frameRate sourceURL } } }`;
const SHARE_CLIP_HASH='2db6a3b20eabf510bd3cf465ae2408834b59eb6b8af89ca73ab1486cacecfb63';
const string=v=>typeof v==='string'&&v.trim()?v.trim():'';
const ownData=(o,k)=>{try{const d=Object.getOwnPropertyDescriptor(o,k);return d&&'value'in d?d.value:undefined;}catch{return undefined;}};
const number=v=>Number.isFinite(Number(v))?Number(v):0;

export function twitchClipSlug(rawUrl){try{const u=new URL(rawUrl),h=u.hostname.toLowerCase();if(!/(^|\.)twitch\.tv$/.test(h))return '';const query=u.searchParams.get('clip');if(query)return query;if(h==='clips.twitch.tv'){const part=u.pathname.slice(1).split('/')[0]||'';return part.toLowerCase()==='embed'?'':part;}return u.pathname.match(/^\/(?:[^/]+\/)?clip\/([^/?#]+)/i)?.[1]||'';}catch{return '';}}
function quality(v){if(!v||typeof v!=='object')return null;const url=string(ownData(v,'sourceURL')||ownData(v,'sourceUrl')||ownData(v,'url'));if(!/^https?:\/\//i.test(url))return null;const label=String(ownData(v,'quality')||ownData(v,'name')||'');return{url,quality:label,height:number(ownData(v,'height'))||number(label)||number(label.match(/(\d{3,4})p/i)?.[1]),frameRate:number(ownData(v,'frameRate'))};}
function clipQualities(clip){const direct=Array.isArray(ownData(clip,'videoQualities'))?ownData(clip,'videoQualities'):[];const assets=ownData(clip,'assets');const primary=Array.isArray(assets)&&assets[0]&&Array.isArray(ownData(assets[0],'videoQualities'))?ownData(assets[0],'videoQualities'):[];return(direct.length?direct:primary).map(quality).filter(Boolean);}

function metadata(root,budget,depth=0,seen=new WeakSet()){
  if(!root||typeof root!=='object'||depth>10||budget.left--<=0||seen.has(root))return null;seen.add(root);
  // Lists on a channel page can contain recommendations. They do not prove
  // which clip belongs to this element; qualities are read explicitly below.
  if(Array.isArray(root))return null;
  const clipValue=ownData(root,'clip'),clip=clipValue&&typeof clipValue==='object'?clipValue:root;
  const slug=string(ownData(clip,'slug')||ownData(clip,'clipSlug')||ownData(root,'clipSlug'));
  const qualities=clipQualities(clip);
  const access=ownData(clip,'playbackAccessToken'),token=access&&typeof access==='object'?access:{};
  const signature=string(ownData(token,'signature')||ownData(clip,'signature')),tokenValue=string(ownData(token,'value')||ownData(clip,'token'));
  if(slug&&(qualities.length||signature||tokenValue||ownData(clip,'title')!==undefined||ownData(clip,'__typename')==='Clip'||ownData(clip,'type')==='clip'))return{kind:'clip',slug,id:string(ownData(clip,'id')),title:string(ownData(clip,'title')),duration:number(ownData(clip,'durationSeconds')||ownData(clip,'duration')),qualities,signature,token:tokenValue};
  const video=ownData(root,'video'),content=ownData(root,'content');
  const typedVideo=video&&typeof video==='object'&&/^(?:Video|VOD)$/i.test(string(ownData(video,'__typename')));
  const typedContent=content&&typeof content==='object'&&/^(?:vod|video)$/i.test(string(ownData(content,'type')));
  const id=typedVideo?string(ownData(video,'id')):typedContent?string(ownData(content,'id')):string(ownData(root,'vodID')||ownData(root,'vodId')||ownData(root,'videoID')||ownData(root,'videoId'));
  if(id&&/^\d+$/.test(id)){const typed=typedVideo?video:typedContent?content:root;return{kind:'vod',id,title:string(ownData(typed,'title')||ownData(root,'title')),duration:number(ownData(typed,'durationSeconds')||ownData(typed,'duration')||ownData(root,'duration')),qualities};}
  for(const key of ['clip','data','props','memoizedProps','state','stateNode','player','video','content','metadata']){const child=ownData(root,key);if(child){const found=metadata(child,budget,depth+1,seen);if(found)return found;}}
  return null;
}

function playerValues(element,budget){const values=[];try{for(const key of Object.getOwnPropertyNames(element)){if(!/^__reactProps|^__reactFiber/.test(key))continue;const candidate=ownData(element,key);if(!candidate)continue;values.push(candidate);const props=ownData(candidate,'memoizedProps'),stateNode=ownData(candidate,'stateNode');if(props)values.push(props);if(stateNode)values.push(stateNode);let fiber=candidate,depth=0;while(fiber&&depth++<24&&budget.left>0){const p=ownData(fiber,'memoizedProps'),s=ownData(fiber,'stateNode');try{if(s?.querySelectorAll?.('video')?.length>1)break;}catch{}if(p)values.push(p);if(s)values.push(s);fiber=ownData(fiber,'return');budget.left--;}}}catch{}for(const key of ['__twitchClip','twitchClip']){const value=ownData(element,key);if(value)values.push(value);}return values;}

export function extractTwitchPlayerMetadata(element,{url='',playerOwner=false,uniquePlayer=false}={}){
  if(!element||typeof element!=='object')return null;const wantedSlug=twitchClipSlug(url),budget={left:640},seen=new WeakSet();let node=element;
  for(let depth=0;node&&depth<12&&budget.left>0;depth++){
    try{if(depth>0&&/^(?:BODY|HTML)$/.test(String(node.tagName||'')))break;if(depth>0&&typeof node.querySelectorAll==='function'&&node.querySelectorAll('video').length>1)break;}catch{}
    for(const value of playerValues(node,budget)){const found=metadata(value,budget,0,seen);if(!found)continue;if(found.kind==='clip'&&wantedSlug&&found.slug!==wantedSlug)continue;return{...found,owner:node};}
    let next=null;try{next=node.parentElement||node.getRootNode?.()?.host||null;}catch{}node=next;
  }
  let standalone=false;try{const u=new URL(url);standalone=/(^|\/)clip\/[^/?#]+(?:$|[?#])/i.test(u.pathname)||u.hostname.toLowerCase()==='clips.twitch.tv';}catch{}
  if(wantedSlug&&standalone&&(playerOwner||uniquePlayer))return{kind:'clip',slug:wantedSlug,id:'',title:'',duration:0,qualities:[],signature:'',token:'',owner:element};return null;
}

export function tokenizedTwitchClipUrl(rawUrl,{signature='',token=''}={}){if(!/^https?:\/\//i.test(string(rawUrl)))return '';if(!signature||!token)return rawUrl;try{const u=new URL(rawUrl);u.searchParams.set('sig',signature);u.searchParams.set('token',token);return u.href;}catch{return rawUrl;}}

const unavailable=()=>Object.assign(new Error('Twitch 未提供此 Clip 的播放來源'),{code:'SOURCE_UNAVAILABLE'});
async function readClipJson(response,signal){
  if(!response?.ok){await response?.body?.cancel?.().catch(()=>{});throw Object.assign(new Error('Twitch Clip 播放 API 拒絕請求'),{status:response?.status||0});}
  const limit=256*1024;
  if(Number(response.headers?.get?.('content-length'))>limit){await response.body?.cancel?.().catch(()=>{});throw unavailable();}
  let value;
  if(response.body?.getReader){
    const reader=response.body.getReader(),decoder=new TextDecoder();let total=0,text='';
    try{for(;;){signal?.throwIfAborted();const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>limit)throw unavailable();text+=decoder.decode(part.value,{stream:true});}value=JSON.parse(text+decoder.decode());}
    finally{await reader.cancel().catch(()=>{});}
  }else if(typeof response.text==='function'){
    const text=await response.text();if(text.length>limit)throw unavailable();value=JSON.parse(text);
  }else value=await response.json();
  signal?.throwIfAborted();return value;
}

export async function twitchClipManifest(metadataOrSlug,fetchImpl=globalThis.fetch,{signal}={}){
  const existing=typeof metadataOrSlug==='object'?metadataOrSlug:null;
  const signed=existing?.signature&&existing?.token||existing?.qualities?.every(item=>{try{const u=new URL(item.url);return !!u.searchParams.get('sig')&&!!u.searchParams.get('token');}catch{return false;}});
  if(existing?.kind==='clip'&&existing.qualities?.length&&signed)return existing;
  const slug=typeof metadataOrSlug==='string'?metadataOrSlug:string(existing?.slug);
  if(!/^[\w-]{1,256}$/.test(slug)||typeof fetchImpl!=='function')return null;
  const requestSignal=AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]);
  const query=async body=>{
    let response;
    try{response=await fetchImpl('https://gql.twitch.tv/gql',{method:'POST',credentials:'omit',headers:{Accept:'*/*','Client-ID':CLIENT_ID,'Content-Type':'text/plain; charset=UTF-8'},body:JSON.stringify(body),signal:requestSignal});}
    catch(error){signal?.throwIfAborted();throw Object.assign(new Error('Twitch Clip 播放來源查詢失敗'),{code:['TimeoutError','AbortError'].includes(error?.name)?'NETWORK_TIMEOUT':'NETWORK_FAILURE'});}
    return readClipJson(response,requestSignal);
  };
  const json=await query({operationName:'ShareClipRenderStatus',variables:{slug},extensions:{persistedQuery:{version:1,sha256Hash:SHARE_CLIP_HASH}}});
  let clip=json?.data?.clip;
  if(!clip&&Array.isArray(json?.errors)&&json.errors.some(error=>/PersistedQuery|Cannot query field|Unknown operation/i.test(error?.message||'')))
    clip=(await query({operationName:'Clip',query:CLIP_QUERY,variables:{slug}}))?.data?.clip;
  if(!clip)throw unavailable();
  const token=clip.playbackAccessToken||{},qualities=clipQualities(clip).slice(0,32).map(item=>({...item,url:tokenizedTwitchClipUrl(item.url,{signature:token.signature,token:token.value})}));
  return{kind:'clip',id:string(clip.id),slug:string(clip.slug)||slug,title:string(clip.title).slice(0,512),duration:number(clip.durationSeconds),signature:string(token.signature),token:string(token.value),qualities};
}
export{CLIENT_ID,CLIP_QUERY};
