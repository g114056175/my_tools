// Source metadata lives while a popup/operation owns its tab or a job retains
// the source. Only the last release starts the short idle grace period.
export const SOURCE_IDLE_MS=60_000;
export function createSourceRetention({sources,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,onExpire=()=>{},idleMs=SOURCE_IDLE_MS}){
 const activeTabs=new Set(),idleSince=new Map(),accepted=new Set(),superseded=new Set();
 const ownerSources=new Map(),ownerRequestOrders=new Map(),sourceOwners=new Map(),latestByScope=new Map();
 let timer=null,deadline=null;

 const sourceOrder=source=>Number.isSafeInteger(source?.inspectionOrder)?source.inspectionOrder:null;
 function scopeOf(source){
  const d=source?.descriptor,frameId=d?.frameId??0,key=d?.mediaKey;
  if(!Number.isInteger(d?.tabId)||d.tabId<0||typeof d.documentId!=='string'||!d.documentId||!Number.isInteger(frameId)||frameId<0||!['number','string'].includes(typeof key)||String(key)==='')return null;
  // Keep mediaKey type as part of the identity; labels, URLs and platform ids
  // are deliberately insufficient to join two source lifetimes.
  return JSON.stringify([d.tabId,d.documentId,frameId,typeof key,key]);
 }
 const hasOwners=id=>!!sourceOwners.get(id)?.size;
 const held=(id,source)=>Number(source.references)>0||hasOwners(id)||activeTabs.has(source.descriptor?.tabId);

 function forgetLatestIfOrphaned(scope){
  if(!scope)return;
  const latest=latestByScope.get(scope);if(!latest)return;
  for(const [id,source]of sources)if(accepted.has(id)&&scopeOf(source)===scope)return;
  latestByScope.delete(scope);
 }
 function removeSource(id,source=sources.get(id)){
  if(!source||!sources.has(id))return null;
  const scope=scopeOf(source);sources.delete(id);idleSince.delete(id);accepted.delete(id);superseded.delete(id);
  for(const ownerId of sourceOwners.get(id)||[])if(ownerSources.get(ownerId)===id){ownerSources.delete(ownerId);ownerRequestOrders.delete(ownerId);}
  sourceOwners.delete(id);forgetLatestIfOrphaned(scope);return [id,source];
 }
 function cleanOwners(){
  for(const id of accepted)if(!sources.has(id))accepted.delete(id);
  for(const id of superseded)if(!sources.has(id))superseded.delete(id);
  for(const [ownerId,id]of ownerSources)if(!sources.has(id)){
   ownerSources.delete(ownerId);ownerRequestOrders.delete(ownerId);const owners=sourceOwners.get(id);owners?.delete(ownerId);if(!owners?.size)sourceOwners.delete(id);
  }
  for(const [id,owners]of sourceOwners){
   for(const ownerId of owners)if(ownerSources.get(ownerId)!==id)owners.delete(ownerId);
   if(!sources.has(id)||!owners.size)sourceOwners.delete(id);
  }
  for(const ownerId of ownerRequestOrders.keys())if(!ownerSources.has(ownerId))ownerRequestOrders.delete(ownerId);
  for(const [scope,latest]of latestByScope){
   if(sources.has(latest.id))continue;
   let found=false;for(const [id,source]of sources)if(accepted.has(id)&&scopeOf(source)===scope){found=true;break;}
   if(!found)latestByScope.delete(scope);
  }
 }
 function notifyRemoved(removed){
  if(removed.length)try{Promise.resolve(onExpire(removed)).catch(()=>{});}catch{}
 }
 function refresh(){
  const at=now(),removed=[];cleanOwners();
  for(const id of idleSince.keys())if(!sources.has(id))idleSince.delete(id);
  for(const [id,source]of sources){
   if(superseded.has(id)){
    idleSince.delete(id);
    if(!(Number(source.references)>0)&&!hasOwners(id)){const entry=removeSource(id,source);if(entry)removed.push(entry);}
    continue;
   }
   if(held(id,source)){idleSince.delete(id);continue;}
   if(!idleSince.has(id))idleSince.set(id,at);
   const releasedAt=idleSince.get(id);
   if(at<releasedAt||at-releasedAt>=idleMs){const entry=removeSource(id,source);if(entry)removed.push(entry);}
  }
  let next=null;for(const releasedAt of idleSince.values())next=next===null?releasedAt+idleMs:Math.min(next,releasedAt+idleMs);
  if(next!==deadline){
   if(timer!==null)clearTimer(timer);
   deadline=next;timer=next===null?null:setTimer(()=>{timer=null;deadline=null;refresh();},Math.max(0,next-at));
  }
  notifyRemoved(removed);
 }
 function detachOwner(ownerId){
  const id=ownerSources.get(ownerId);ownerRequestOrders.delete(ownerId);if(id===undefined)return undefined;
  ownerSources.delete(ownerId);const owners=sourceOwners.get(id);owners?.delete(ownerId);if(!owners?.size)sourceOwners.delete(id);return id;
 }
 function attachOwner(ownerId,id){
  ownerSources.set(ownerId,id);let owners=sourceOwners.get(id);if(!owners){owners=new Set();sourceOwners.set(id,owners);}owners.add(ownerId);
 }
 function reconcileScope(scope){
  if(!scope)return;
  const latest=latestByScope.get(scope);if(!latest)return;
  for(const [id,source]of sources){
   if(!accepted.has(id)||scopeOf(source)!==scope)continue;
   const order=sourceOrder(source);
   if(order!==null&&latest.order!==null&&(order<latest.order||order===latest.order&&id!==latest.id))superseded.add(id);
  }
 }

 return {
  refresh,
  isAccepted(sourceId){return accepted.has(sourceId)&&sources.has(sourceId);},
  accept(sourceId,ownerId='',ownerRequestOrder){
   const source=sources.get(sourceId);if(!source)return false;
   accepted.add(sourceId);idleSince.delete(sourceId);
   const scope=scopeOf(source),order=sourceOrder(source);
   if(scope&&order!==null){
    const latest=latestByScope.get(scope);
    if(!latest||latest.order===null||order>latest.order)latestByScope.set(scope,{id:sourceId,order});
    else if(order===latest.order&&sourceId!==latest.id)superseded.add(sourceId);
   }else if(scope&&!latestByScope.has(scope))latestByScope.set(scope,{id:sourceId,order:null});

   if(typeof ownerId==='string'&&ownerId){
    const previousId=ownerSources.get(ownerId);
    const requestOrder=Number.isSafeInteger(ownerRequestOrder)?ownerRequestOrder:order;
    const previousOrder=ownerRequestOrders.get(ownerId);
    if(previousId===undefined){
     attachOwner(ownerId,sourceId);ownerRequestOrders.set(ownerId,requestOrder);
    }else if(previousId===sourceId){
     if(previousOrder===undefined||requestOrder!==null&&(previousOrder===null||requestOrder>previousOrder))ownerRequestOrders.set(ownerId,requestOrder);
    }else if(previousOrder===undefined||requestOrder===null&&previousOrder===null||requestOrder!==null&&(previousOrder===null||requestOrder>previousOrder)){
     detachOwner(ownerId);attachOwner(ownerId,sourceId);ownerRequestOrders.set(ownerId,requestOrder);
    }
   }

   reconcileScope(scope);refresh();return sources.has(sourceId);
  },
  releaseOwner(ownerId){
   if(typeof ownerId!=='string'||!ownerId)return;
   detachOwner(ownerId);refresh();
  },
  discard(sourceId){
   const source=sources.get(sourceId);
   if(!source||accepted.has(sourceId)||Number(source.references)>0)return false;
   const removed=removeSource(sourceId,source);if(removed)notifyRemoved([removed]);refresh();return !!removed;
  },
  setActiveTabs(ids){
   const next=new Set((Array.isArray(ids)?ids:[]).filter(id=>Number.isInteger(id)&&id>=0));
   if(next.size===activeTabs.size&&[...next].every(id=>activeTabs.has(id)))return;
   // A delayed timer must not let a later popup revive an already expired entry.
   refresh();
   activeTabs.clear();for(const id of next)activeTabs.add(id);refresh();
  },
  clear(){
   if(timer!==null)clearTimer(timer);timer=null;deadline=null;activeTabs.clear();idleSince.clear();
   accepted.clear();superseded.clear();ownerSources.clear();ownerRequestOrders.clear();sourceOwners.clear();latestByScope.clear();
  },
 };
}
