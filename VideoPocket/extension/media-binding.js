// Read only metadata already owned by a rendered player. Never inspect the
// application root, sibling fibers, network credentials or private stores.
export function ownedPlayerMetadata(video){
  const seen=new WeakSet();let remaining=1600;
  const inspect=value=>{
    const ids=new Set(),payloads=[];
    const walk=(node,depth=0)=>{
      if(!node||typeof node!=='object'||depth>9||seen.has(node)||--remaining<0)return;
      seen.add(node);
      let fields;try{fields=Object.getOwnPropertyDescriptors(node);}catch{return;}
      for(const key of ['videoID','videoId','video_id','videoFBID','mediaID','media_id']){
        const id=fields[key]?.value;if((typeof id==='string'||typeof id==='number')&&String(id).length<256&&String(id))ids.add(String(id));
      }
      if(fields.videoDeliveryLegacyFields?.value||fields.video_versions?.value||fields.video_dash_manifest?.value||fields.video_url?.value||fields.playable_url?.value||fields.request?.value?.files||fields.play?.value){
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
  for(let level=0;node&&level<10&&remaining>0;level++,node=node.parentElement){
    try{if(level&&node.querySelectorAll?.('video').length>1)break;}catch{break;}
    let descriptors;try{descriptors=Object.getOwnPropertyDescriptors(node);}catch{continue;}
    for(const [key,entry] of Object.entries(descriptors)){
      if(!/^__react(?:Props|Fiber)\$/.test(key))continue;
      if(key.startsWith('__reactProps$')){const result=inspect(entry.value);if(result.ids.length||result.payloads.length)return result;}
      else {
        let fiber=entry.value;
        for(let depth=0;fiber&&depth<24&&remaining>0;depth++){
          const host=fiber.stateNode;
          try{if(host&&host!==video&&host.nodeType===1&&host.querySelectorAll?.('video').length>1)break;}catch{break;}
          const result=inspect(fiber.memoizedProps);
          if(result.ids.length||result.payloads.length)return result;
          fiber=fiber.return;
        }
      }
    }
  }
  return {ids:[],payloads:[]};
}
