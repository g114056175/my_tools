// A selected source may outlive popup observation and the MV3 worker.
// Keep only bounded, short-lived snapshots in the offscreen engine's memory.
// Callers validate source ownership before comparing captures.
export function preferYoutubeSession(previous,incoming){
 if(!previous)return incoming||null;if(!incoming)return previous;
 const length=value=>Number.isSafeInteger(value?.poLength)&&value.poLength>0?value.poLength:0;
 const oldLength=length(previous),newLength=length(incoming);
 return oldLength>newLength||oldLength===newLength&&previous.createdAt>incoming.createdAt?previous:incoming;
}
export function createYoutubeSourceSessions({now=Date.now,ttlMs=30*60*1000,maxEntries=20,maxBodyLength=87384}={}){
 const entries=new Map();
 const clone=value=>structuredClone(value);
 const identity=descriptor=>{
  if(descriptor?.platform?.site!=='youtube'||typeof descriptor.platform.id!=='string'||!descriptor.platform.id.trim()||!Number.isInteger(descriptor.tabId)||descriptor.tabId<0||typeof descriptor.documentId!=='string'||!descriptor.documentId)return null;
  const frameId=descriptor.frameId??0;if(!Number.isInteger(frameId)||frameId<0)return null;
  let streamId;try{const url=new URL(descriptor.platform.streamingData?.serverAbrStreamingUrl);if(url.protocol!=='https:')return null;streamId=url.searchParams.get('id');}catch{return null;}
  if(!streamId)return null;
  return {key:JSON.stringify([descriptor.tabId,descriptor.documentId,frameId,descriptor.platform.id,streamId]),tabId:descriptor.tabId,documentId:descriptor.documentId,frameId,streamId};
 };
 const fresh=capture=>Number.isFinite(capture?.createdAt)&&now()-capture.createdAt>=0&&now()-capture.createdAt<ttlMs;
 const prune=()=>{for(const [key,entry] of entries)if(!fresh(entry.capture))entries.delete(key);};
 return {
  remember(descriptor,capture){
   const id=identity(descriptor);
   if(!id||!fresh(capture)||capture.tabId!==id.tabId||capture.documentId!==id.documentId||(capture.frameId!=null&&capture.frameId!==id.frameId)||capture.streamId!==id.streamId||typeof capture.body!=='string'||!capture.body.length||capture.body.length>maxBodyLength)return null;
   prune();const previous=entries.get(id.key)?.capture;
   if(previous&&preferYoutubeSession(previous,capture)===previous)return clone(previous);
   entries.delete(id.key);entries.set(id.key,{tabId:id.tabId,capture:clone(capture)});
   while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
   return clone(capture);
  },
  get(descriptor){
   prune();const id=identity(descriptor),entry=id&&entries.get(id.key);if(!entry)return null;
   entries.delete(id.key);entries.set(id.key,entry);return clone(entry.capture);
  },
  removeTab(tabId){for(const [key,entry] of entries)if(entry.tabId===tabId)entries.delete(key);},
  retainSources(descriptors){
   const keys=new Set(descriptors.map(identity).filter(Boolean).map(value=>value.key));
   for(const key of entries.keys())if(!keys.has(key))entries.delete(key);
  },
  clear(){entries.clear();},
  get size(){prune();return entries.size;},
 };
}
