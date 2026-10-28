import {VideoPlaybackAbrRequest} from './vendor/sabr.js';

// Validate a bounded snapshot read from this selected player's own request
// state. It is retained by the existing source lifetime, not by a new cache.
export function youtubePageSession(descriptor,result,now=Date.now()){
 const platform=descriptor?.platform;
 if(platform?.site!=='youtube'||result?.changed||result?.videoId!==platform.id||!descriptor.documentId||!Number.isInteger(descriptor.tabId)||descriptor.tabId<0)return null;
 const streamId=raw=>{try{const url=new URL(raw);return url.protocol==='https:'&&/(^|\.)googlevideo\.com$/.test(url.hostname)&&url.pathname==='/videoplayback'?url.searchParams.get('id'):null;}catch{return null;}};
 const id=streamId(platform.streamingData?.serverAbrStreamingUrl);
 if(!id||result.streamId!==id||streamId(result.url)!==id||typeof result.config!=='string'||result.config.length>87384||!Array.isArray(result.candidates)||result.candidates.length>4)return null;
 const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 let config;try{config=decode(result.config);}catch{return null;}
 if(!config.length)return null;
 let selected=null;
 for(const body of result.candidates){
  if(typeof body!=='string'||!body.length||body.length>87384)continue;
  try{
   const bytes=decode(body);if(bytes.length>65536)continue;
   const seed=VideoPlaybackAbrRequest.decode(bytes),actual=seed.videoPlaybackUstreamerConfig;
   if(!seed.streamerContext?.clientInfo||actual.length!==config.length||actual.some((byte,index)=>byte!==config[index]))continue;
   const capture={tabId:descriptor.tabId,documentId:descriptor.documentId,frameId:descriptor.frameId??0,url:result.url,streamId:id,body,poLength:seed.streamerContext.poToken?.length||0,createdAt:now};
   if(!selected||capture.poLength>selected.poLength)selected=capture;
  }catch{}
 }
 return selected;
}

// Serialized into the selected document's MAIN world. Read existing state
// only: no play, seek, quality changes, network calls or persistent hooks.
export function readYoutubePageSession(expected){
 const player=document.querySelector('#movie_player'),video=player?.querySelector('video');
 const id=()=>{try{const url=new URL(location.href);return url.searchParams.get('v')||url.pathname.split('/shorts/')[1]?.split('/')[0];}catch{return null;}};
 const identity=window[Symbol.for('video-pocket.identities')];
 const same=()=>document.querySelector('#movie_player')===player&&player?.querySelector('video')===video&&id()===expected.videoId&&player?.getPlayerResponse?.()?.videoDetails?.videoId===expected.videoId&&(expected.mediaKey==null||identity?.keys?.get(video)===expected.mediaKey);
 if(!video||!same())return {changed:true};
 const response=player.getPlayerResponse(),selectedConfig=response.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig;
 if(typeof selectedConfig!=='string'||!selectedConfig.length||selectedConfig.length>87384)return {missing:true};
 const streamId=raw=>{try{const url=new URL(raw);return url.protocol==='https:'&&/(^|\.)googlevideo\.com$/.test(url.hostname)&&url.pathname==='/videoplayback'?url.searchParams.get('id'):null;}catch{return null;}};
 const currentUrl=response.streamingData?.serverAbrStreamingUrl;
 if(!streamId(currentUrl)||streamId(currentUrl)!==expected.streamId)return {changed:true};
 const sabr=new URL(currentUrl).searchParams.get('sabr');
 const resources=performance.getEntriesByType('resource').filter(entry=>streamId(entry.name)===expected.streamId&&(sabr==null||new URL(entry.name).searchParams.get('sabr')===sabr));
 let url=resources.at(-1)?.name||null,preparedUrl=false;
 const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
 const normal=value=>String(value).replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'');
 const config=normal(selectedConfig),seen=new WeakSet(),queue=[],candidates=[],seenBodies=new Set();let steps=0,properties=0;
 const begin=performance.now(),own=(object,key)=>{try{return Object.getOwnPropertyDescriptor(object,key)?.value;}catch{return undefined;}};
 const requestUrl=root=>{
  const info=own(root,'info'),siblings=info?Object.getOwnPropertyNames(root).slice(0,128).filter(name=>name!=='info').map(name=>own(root,name)):[];
  const pending=info?[...siblings.map(value=>({value,depth:0})),{value:info,depth:0}]:[{value:root,depth:0}],visited=new WeakSet();
  for(let at=0;at<pending.length&&at<64;at++){
   const {value,depth}=pending[at];if(!value||typeof value!=='object'||visited.has(value)||ArrayBuffer.isView(value)||value instanceof Node)continue;visited.add(value);
   let names;try{names=Object.getOwnPropertyNames(value).slice(0,128);}catch{continue;}
   for(const name of names){const item=own(value,name);
    if(name!=='resource'&&typeof item==='string'&&item.length<=16384&&streamId(item)===expected.streamId&&(sabr==null||new URL(item).searchParams.get('sabr')===sabr))return item;
    if(depth<3&&item&&typeof item==='object'&&pending.length<64)pending.push({value:item,depth:depth+1});
   }
  }
  return null;
 };
 const add=(value,depth)=>{
  if(!value||typeof value!=='object'||seen.has(value)||depth>14||queue.length>=15000||ArrayBuffer.isView(value)||value instanceof ArrayBuffer||value===window||value===document||value instanceof Node)return;
  seen.add(value);queue.push({value,depth});
 };
 // Player event bindings retain the active loader, including a prepared SABR
 // request while playback is paused. Follow structure rather than minified keys.
 add(own(window,'ytPubsubPubsubInstance'),0);add(own(window,'ytplayer'),0);
 while(steps<queue.length&&properties<100000&&performance.now()-begin<200){
  const {value,depth}=queue[steps++];let names;try{names=Object.getOwnPropertyNames(value).slice(0,4096);}catch{continue;}
  const values=names.map(name=>own(value,name));properties+=names.length;
  const info=own(value,'info'),request=Number.isInteger(own(value,'requestType'))?value:info;
  if(Number.isInteger(own(request,'requestType'))&&own(request,'resource')){
   let requestValues;try{requestValues=request===value?values:Object.getOwnPropertyNames(request).slice(0,128).map(name=>own(request,name));}catch{continue;}
   const settings=requestValues.find(item=>item&&typeof item==='object'&&own(item,'videoPlaybackUstreamerConfig') instanceof Uint8Array);
   const bytes=own(settings,'videoPlaybackUstreamerConfig');
   if(bytes?.byteLength<=65536&&normal(base64(bytes))===config){
    // Streaming fetches may still be open and absent from Resource Timing.
    // The owning loader keeps the actual, already prepared request URL.
    if(!preparedUrl){const found=requestUrl(value);if(found){url=found;preparedUrl=true;}}
    for(const item of requestValues)if(item instanceof Uint8Array&&item.byteLength>bytes.byteLength&&item.byteLength<=65536){
     const body=base64(item);if(!seenBodies.has(body)){seenBodies.add(body);candidates.push(body);if(candidates.length===4)break;}
    }
   }
  }
  if(candidates.length===4)break;
  if(value instanceof Map)try{let count=0;for(const item of value.values()){if(count++>=256)break;add(item,depth+1);}}catch{}
  for(const item of values)add(item,depth+1);
 }
 if(!same()||streamId(player.getPlayerResponse?.()?.streamingData?.serverAbrStreamingUrl)!==expected.streamId)return {changed:true};
 if(!url)return {missing:true};
 return {videoId:expected.videoId,streamId:expected.streamId,url,config:selectedConfig,candidates};
}
