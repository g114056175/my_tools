// Read only metadata already owned by a rendered player. Never inspect the
// application root, sibling fibers, network credentials or private stores.
import {ownedXPlayerMetadata} from './x-media.js';
import {facebookPlayerPayload} from './facebook-player.js';
// Scheduling hints only. Avoid a second whole-document evidence scan just to
// decide which queued metadata to parse first. Exact ownership is checked later.
export function selectedMediaHint(video,{pageUrl=''}={}){
  if(!video)return ()=>false;
  const ids=new Set();
  try{for(const id of ownedPlayerMetadata(video,{pageUrl}).ids.slice(0,8))ids.add(String(id));}catch{}
  for(const key of ['data-video-id','data-media-id','data-reel-id','data-post-id','data-content-id']){
    try{const id=video.getAttribute?.(key);if(id)ids.add(String(id));}catch{}
  }
  const values=[...ids].filter(id=>/^[\w.-]{3,256}$/.test(id)).map(id=>id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  if(!values.length)return ()=>false;
  const pattern=new RegExp(`(?:^|["\\\\/:])(?:\\d+_)?(?:${values.join('|')})(?=$|["\\\\/?&#,}])`);
  return text=>typeof text==='string'&&pattern.test(text);
}
export function ownedPlayerMetadata(video,{pageUrl=''}={}){
  try{if(/(^|\.)(?:x|twitter)\.com$/i.test(new URL(pageUrl || video?.ownerDocument?.location?.href || '').hostname))return ownedXPlayerMetadata(video);}catch{}
  const seen=new WeakSet();let remaining=1600,nearestIds=[];
  const inspect=value=>{
    const ids=new Set(),payloads=[];
    const walk=(node,depth=0)=>{
      if(!node||typeof node!=='object'||depth>9||seen.has(node)||--remaining<0)return;
      seen.add(node);
      let fields;try{fields=Object.getOwnPropertyDescriptors(node);}catch{return;}
      const facebook=fields.coreVideoPlayerMetaData?.value?facebookPlayerPayload(node,{pageUrl}):null;
      if(facebook){payloads.push(facebook);ids.add(facebook.id);}
      const nested=fields.video?.value;
      if(nested&&typeof nested==='object')try{
        const child=Object.getOwnPropertyDescriptors(nested),id=fields.id?.value;
        if((typeof id==='string'||typeof id==='number')&&String(id)===String(child.id?.value)&&['playAddr','downloadAddr','PlayAddrStruct','video_versions'].some(key=>child[key]?.value)){
          payloads.push(node);ids.add(String(id));
        }
      }catch{}
      for(const key of ['videoID','videoId','video_id','videoFBID','mediaID','media_id','aweme_id']){
        const id=fields[key]?.value;if((typeof id==='string'||typeof id==='number')&&String(id).length<256&&String(id))ids.add(String(id));
      }
      if(fields.videoDeliveryLegacyFields?.value||fields.videoDeliveryResponseFragment?.value||fields.video_versions?.value||fields.video_dash_manifest?.value||fields.video_url?.value||fields.playable_url?.value||fields.playAddr?.value||fields.play_addr?.value||fields.PlayAddrStruct?.value||fields.downloadAddr?.value||fields.download_addr?.value||fields.bitrateInfo?.value||fields.bitrate_info?.value||fields.request?.value?.files||fields.play?.value){
        payloads.push(node);for(const key of ['id','videoId','video_id','media_id']){const id=fields[key]?.value;if(typeof id==='string'||typeof id==='number')ids.add(String(id));}
        const uri=fields.uri?.value;if(typeof uri==='string'&&/^\/videos\/\d+$/.test(uri))ids.add(uri.split('/').pop());
      }
      for(const [key,field] of Object.entries(fields).slice(0,160)){
        if(['return','child','sibling','stateNode','_owner','ref','current','ownerDocument','parentNode'].includes(key))continue;
        const child=field.value;if(child&&typeof child==='object'&&!child.nodeType)walk(child,depth+1);
      }
    };
    walk(value);return {ids:[...ids],payloads};
  };
  let node=video;
  for(let level=0;node&&level<16&&remaining>0;level++,node=node.parentElement){
    try{if(level&&node.querySelectorAll?.('video').length>1)break;}catch{break;}
    let descriptors;try{descriptors=Object.getOwnPropertyDescriptors(node);}catch{continue;}
    for(const [key,entry] of Object.entries(descriptors)){
      if(!/^__react(?:Props|Fiber)\$/.test(key))continue;
      if(key.startsWith('__reactProps$')){const result=inspect(entry.value);if(result.payloads.length)return {...result,ids:[...new Set([...nearestIds,...result.ids])]};if(!nearestIds.length&&result.ids.length)nearestIds=result.ids;}
      else {
        let fiber=entry.value;
        for(let depth=0;fiber&&depth<24&&remaining>0;depth++){
          const host=fiber.stateNode;
          try{if(host&&host!==video&&host.nodeType===1&&host.querySelectorAll?.('video').length>1)break;}catch{break;}
          const result=inspect(fiber.memoizedProps);
          if(result.payloads.length)return {...result,ids:[...new Set([...nearestIds,...result.ids])]};
          if(!nearestIds.length&&result.ids.length)nearestIds=result.ids;
          fiber=fiber.return;
        }
      }
    }
  }
  return {ids:nearestIds,payloads:[]};
}
