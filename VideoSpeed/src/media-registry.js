import {mediaTitle} from './media-title.js';
const sourceObjectIds=new WeakMap();let sourceObjectSerial=0;
function sourceObjectKey(video){
 try{
  const source=video.srcObject;if(!source||(typeof source!=='object'&&typeof source!=='function'))return '';
  if(!sourceObjectIds.has(source))sourceObjectIds.set(source,'object:'+ ++sourceObjectSerial);
  return sourceObjectIds.get(source);
 }catch{return '';}
}
const YT_CARD='ytd-video-preview,#video-preview,#inline-preview-player,ytd-moving-thumbnail-renderer,ytd-thumbnail,yt-thumbnail-view-model,yt-lockup-view-model,ytd-video-renderer,ytd-rich-item-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,ytd-playlist-video-renderer,ytd-reel-item-renderer';
const BILI_CARD='bili-video-card,.bili-video-card,.video-card,.video-card-common';
const MAX_MUTATION_BATCHES=64,MAX_MUTATION_RECORDS=4096,MAX_MUTATION_NODES=4096;
function linkId(card,platform,target){
 const links=card?.querySelectorAll?.('a[href]')||[];
 for(const link of links){
  try{
   const url=new URL(link.href||link.getAttribute?.('href')||'',target.location.href);
   if(platform==='youtube'&&/(^|\.)youtube\.com$/.test(url.hostname)){
    const id=url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];if(id)return id;
   }
   if(platform==='bilibili'&&/(^|\.)bilibili\.com$/.test(url.hostname)){
    const id=url.pathname.match(/^\/video\/([^/?#]+)/)?.[1]||url.pathname.match(/^\/bangumi\/play\/(ep\d+)/)?.[1];if(id)return id;
   }
  }catch{}
 }
 return '';
}
function cardValue(card,names){for(const name of names){const value=card?.getAttribute?.(name);if(value)return String(value).trim();}return '';}
function previewCard(video,selector,platform,attrs,target){
 let card=video.closest?.(selector);const shell=card;
 for(let depth=0;card&&depth<5;depth++,card=card.parentElement?.closest?.(selector)){
  const id=cardValue(card,attrs)||linkId(card,platform,target);if(id)return {card,id};
 }
 if(shell?.nodeType===1){const bound=video.getAttribute?.('data-video-control-preview-id')||'',source=video.currentSrc||video.src||'';if(bound||source)return {card:shell,id:bound||source};}
 return null;
}
/** Identify only media embedded in a known YouTube or Bilibili preview shell/card.
 * A card ID, verified player ID or source distinguishes recycled preview content.
 */
export function mediaPreviewInfo(video,target=globalThis){
 try{
  const host=new URL(target.location.href).hostname;
  if(/(^|\.)youtube\.com$/.test(host)){
   const owner=previewCard(video,YT_CARD,'youtube',['data-video-id','video-id','data-id'],target);if(!owner)return null;
   const source=video.currentSrc||video.src||video.getAttribute?.('src')||'';
   return {platform:'youtube',card:owner.card,id:owner.id,signature:`preview:yt:${owner.id}:${source}`};
  }
  if(/(^|\.)bilibili\.com$/.test(host)){
   const owner=previewCard(video,BILI_CARD,'bilibili',['data-bvid','bvid','data-aid','aid','data-epid'],target);if(!owner)return null;
   const source=video.currentSrc||video.src||video.getAttribute?.('src')||'';
   return {platform:'bilibili',card:owner.card,id:owner.id,signature:`preview:bili:${owner.id}:${source}`};
  }
 }catch{}
 return null;
}
export function mediaSignature(video,target=globalThis){
 const preview=mediaPreviewInfo(video,target);if(preview)return preview.signature;
 let route='';
 try{
  const url=new URL(target.location.href),host=url.hostname;
  if(/(^|\.)youtube\.com$/.test(host)&&video.closest?.('#movie_player,.html5-video-player'))route='yt:'+(url.searchParams.get('v')||url.pathname.match(/\/(?:shorts|embed)\/([^/]+)/)?.[1]||'');
  if(/(^|\.)bilibili\.com$/.test(host)&&video.closest?.('.bpx-player-container,#bilibili-player,bwp-video'))route='bili:'+url.pathname.replace(/\/+$/,'')+':'+Math.max(1,Math.floor(Number(url.searchParams.get('p')))||1);
 }catch{}
 return route||video.getAttribute?.('data-video-control-content-id')||video.getAttribute?.('data-video-id')||sourceObjectKey(video)||video.currentSrc||video.src||'';
}
export function mediaCanInitialize(video,target=globalThis){
 try{
  if(mediaPreviewInfo(video,target))return true;
  const url=new URL(target.location.href),player=video.closest?.('#movie_player,.html5-video-player');
  if(!/(^|\.)youtube\.com$/.test(url.hostname)||!player)return true;
  if(player.classList?.contains('ad-showing')||player.classList?.contains('ad-interrupting')||video.getAttribute('data-video-control-ad')==='true')return false;
  const id=url.searchParams.get('v')||url.pathname.match(/\/(?:shorts|embed)\/([^/]+)/)?.[1];
  return !id||video.getAttribute('data-video-control-ready')==='true'&&video.getAttribute('data-video-control-ready-key')==='yt:'+id;
 }catch{return false;}
}
export class MediaRegistry{
 constructor(document,onAdd,onChange,{owner=globalThis.crypto?.randomUUID?.()||String(Math.random()),exploring=true}={}){
  Object.assign(this,{document,onAdd,onChange,owner,exploring,videos:new Map(),ids:new WeakMap(),serial:0,observers:new Map(),titleCache:new WeakMap(),walkQueue:[],walkDeferred:new Map(),walkedRoots:new WeakSet(),mutationQueue:[],pendingMutationNodes:0,pendingMutationRecords:0,walkTurn:false,walkTimer:null,disposed:false});
  const seenEvents=new WeakSet();
  this.discover=event=>{if(seenEvents.has(event))return;seenEvents.add(event);const video=event.composedPath?.().find(node=>node?.tagName==='VIDEO');if(video&&(this.exploring||this.ids.has(video))){this.add(video);if(event.type==='play')this.notePlay(video);this.onChange();}};
  this.scan(document);this.enqueue(document);
 }
 add(video){
  if(this.disposed||!this.exploring||!video.isConnected||this.ids.has(video))return;
  if(this.videos.size>=64){this.prune();if(this.videos.size>=64){const victim=[...this.videos].find(([,item])=>item.paused)||this.videos.entries().next().value;if(victim)this.remove(...victim);}}
  const id='v'+(++this.serial);this.ids.set(video,id);this.videos.set(id,video);video.setAttribute('data-video-control-registry',this.owner);video.setAttribute('data-video-control-id',id);if(!video.paused&&!video.ended&&!video.getAttribute('data-video-control-last-played'))this.notePlay(video);this.onAdd(video,id);
 }
 notePlay(video){video.setAttribute('data-video-control-last-played',String(Date.now()));}
 clearIdentity(id,video){if(video.getAttribute('data-video-control-registry')===this.owner&&video.getAttribute('data-video-control-id')===id){video.removeAttribute('data-video-control-id');video.removeAttribute('data-video-control-registry');}}
 remove(id,video){this.videos.delete(id);this.ids.delete(video);this.titleCache.delete(video);this.onRemove?.(id,video);this.clearIdentity(id,video);}
 observe(root){
  if(this.disposed||root.host?.id?.startsWith('video-control-')||this.observers.has(root)||this.observers.size>=64)return;
  for(const event of ['play','loadedmetadata','loadstart'])root.addEventListener(event,this.discover,true);
  const observer=new MutationObserver(records=>{
   if(this.disposed||!this.exploring)return;
   const tooManyRecords=records.length>MAX_MUTATION_RECORDS;
   const changed=(tooManyRecords||records.some(record=>record.removedNodes?.length))?this.prune():false;
   if(tooManyRecords)this.deferScope(root);else this.queueMutations(root,records);
   if(changed)this.onChange();
  });
  if(this.exploring)observer.observe(root,{childList:true,subtree:true});this.observers.set(root,observer);
 }
 setExploring(enabled){
  enabled=!!enabled;if(this.disposed||this.exploring===enabled)return;
  this.exploring=enabled;
  if(!enabled){
   clearTimeout(this.walkTimer);this.walkTimer=null;this.walkQueue=[];this.walkDeferred.clear();this.mutationQueue=[];this.pendingMutationNodes=0;this.pendingMutationRecords=0;
   for(const observer of this.observers.values())observer.disconnect();
   return;
  }
  this.prune();this.walkedRoots=new WeakSet();
  for(const [root,observer]of this.observers)observer.observe(root,{childList:true,subtree:true});
  this.scan(this.document);this.enqueue(this.document,{force:true});
 }
 queueMutations(root,records){
  if(this.disposed||!this.exploring||!records?.length)return false;
  if(records.length>MAX_MUTATION_RECORDS||this.mutationQueue.length>=MAX_MUTATION_BATCHES||this.pendingMutationRecords+records.length>MAX_MUTATION_RECORDS){this.deferScope(root);return false;}
  let added=0;
  for(const record of records){
   added+=record.addedNodes?.length||0;
   if(added>MAX_MUTATION_NODES||this.pendingMutationNodes+added>MAX_MUTATION_NODES){this.deferScope(root);return false;}
  }
  if(!added)return true;
  this.mutationQueue.push({root,records,recordIndex:0,nodeIndex:0,currentRoot:null,walker:null});
  this.pendingMutationNodes+=added;this.pendingMutationRecords+=records.length;this.scheduleWalk();return true;
 }
 nextMutationNode(job){
  while(job.recordIndex<job.records.length){
   const nodes=job.records[job.recordIndex].addedNodes||[];
   if(job.nodeIndex<nodes.length)return nodes[job.nodeIndex++];
   job.recordIndex++;job.nodeIndex=0;
  }
  return null;
 }
 walkMutationStep(){
  const job=this.mutationQueue[0];if(!job)return false;
  if(job.walker){
   if(job.currentRoot?.isConnected===false){job.walker=null;job.currentRoot=null;return true;}
   const node=job.walker.nextNode();
   if(node)this.visit(node);else{job.walker=null;job.currentRoot=null;}
   return true;
  }
  const node=this.nextMutationNode(job);
  if(node===null){this.mutationQueue.shift();this.pendingMutationRecords-=job.records.length;return true;}
  this.pendingMutationNodes--;
  if((node.nodeType===1||node.nodeType===11)&&node.isConnected!==false){
   this.visit(node);
   if(node.childNodes?.length){job.currentRoot=node;job.walker=this.document.createTreeWalker(node,1);}
  }
  return true;
 }
 visit(node,session=null){
  if(node.id?.startsWith('video-control-'))return;
  if(node.tagName==='VIDEO')this.add(node);
  if(node.shadowRoot){
   this.observe(node.shadowRoot);
   const root=node.shadowRoot;
   if(session){if(session.roots.has(root))return;if(this.enqueue(root,{force:true,session}))session.roots.add(root);}
   else if(!this.walkedRoots.has(root))this.enqueue(root);
  }
 }
 rootScope(root){
  let scope=root?.nodeType===9||root?.nodeType===11?root:root?.getRootNode?.();
  if(scope?.nodeType===9&&scope!==this.document)scope=this.document;
  if(scope?.nodeType===11&&!this.observers.has(scope))scope=this.document;
  if(scope?.nodeType!==9&&scope?.nodeType!==11)scope=this.document;
  return scope;
 }
 deferScope(root,{session=null}={}){
  if(this.disposed||!this.exploring)return;
  const scope=this.rootScope(root),existing=this.walkDeferred.get(scope);
  if(existing){if(session)existing.session=session;return;}
  const active=this.walkQueue.find(job=>job.root===scope);
  if(active){if(active.walker)active.rescan=true;if(session)active.session=session;return;}
  this.walkDeferred.set(scope,{force:true,session});this.scheduleWalk();
 }
 enqueue(root,{force=false,session=null}={}){
  if(this.disposed||!this.exploring||!root||root.id?.startsWith('video-control-')||root.host?.id?.startsWith('video-control-'))return false;
  if(!force&&!session&&this.walkedRoots.has(root))return false;
  const deferred=this.walkDeferred.get(root);if(deferred){if(session)deferred.session=session;return true;}
  for(const job of this.walkQueue){
   if(job.root===root){
    if(force||session){job.rescan=!!job.walker||job.rescan;job.session=session||job.session;}
    else if(job.walker)job.rescan=true;
    return true;
   }
   let contains=false;try{contains=job.root.contains?.(root)===true;}catch{}
   if(contains&&!job.walker)return true;
  }
  if(this.walkQueue.length>=24){
   const scope=this.rootScope(root);this.deferScope(scope,{session});
   return scope===root;
  }
  this.walkQueue.push({root,walker:null,rescan:false,session});this.scheduleWalk();return true;
 }
 scheduleWalk(){if(!this.walkTimer&&!this.disposed&&this.exploring)this.walkTimer=setTimeout(()=>this.walkBatch(),120);}
 promoteDeferred(){
  while(!this.disposed&&this.walkQueue.length<24&&this.walkDeferred.size){
   const [root,options]=this.walkDeferred.entries().next().value;this.walkDeferred.delete(root);this.enqueue(root,options);
  }
 }
 runWalk(maxNodes,maxMs,notify=true){
  if(this.disposed||!this.exploring)return 0;
  this.promoteDeferred();
  const deadline=performance.now()+maxMs,before=this.serial;let count=0,steps=0;
  while((this.walkQueue.length||this.mutationQueue.length)&&count<maxNodes&&steps<maxNodes&&performance.now()<deadline){
   const hasMutation=this.mutationQueue.length>0,hasWalk=this.walkQueue.length>0;
   if(hasMutation&&(!hasWalk||!this.walkTurn)){
    this.walkTurn=true;this.walkMutationStep();count++;steps++;continue;
   }
   const job=this.walkQueue[0];
   if(job.root.isConnected===false){this.walkQueue.shift();this.promoteDeferred();continue;}
   this.walkTurn=false;
   if(!job.walker){this.visit(job.root,job.session);job.walker=this.document.createTreeWalker(job.root,1);}
   const node=job.walker.nextNode();steps++;
   if(!node){
    if(job.rescan){job.rescan=false;job.walker=null;continue;}
    if(job.root.nodeType===9||job.root.nodeType===11)this.walkedRoots.add(job.root);
    this.walkQueue.shift();this.promoteDeferred();continue;
   }
   count++;this.visit(node,job.session);
  }
  if(!this.walkQueue.length&&!this.walkDeferred.size&&!this.mutationQueue.length&&this.walkTimer){clearTimeout(this.walkTimer);this.walkTimer=null;}
  const added=this.serial-before;if(added&&notify)this.onChange();return added;
 }
 walkBatch(){
  this.walkTimer=null;if(this.disposed)return;
  this.runWalk(128,4);
  if(this.walkQueue.length||this.walkDeferred.size||this.mutationQueue.length)this.scheduleWalk();
 }
 scan(root,deep=false){
  if(!root||this.disposed||!this.exploring||root.host?.id?.startsWith('video-control-'))return false;
  this.prune();const before=this.serial;
  if(root.nodeType===9||root.nodeType===11)this.observe(root);
  if(root.tagName==='VIDEO')this.add(root);
  let count=0;for(const video of root.querySelectorAll?.('video')||[]){this.add(video);if(++count>=64)break;}
  this.visit(root);
  if(root.nodeType===11)this.enqueue(root);
  if(deep){const session={roots:new WeakSet()};session.roots.add(root);this.enqueue(root,{force:true,session});this.runWalk(6000,12,false);}
  const changed=this.serial!==before;if(changed)this.onChange();return changed;
 }
 prune(){
  let changed=false;
  for(const [id,video]of this.videos)if(!video.isConnected){this.remove(id,video);changed=true;}
  for(const [root,observer]of this.observers)if(root.host&&!root.host.isConnected){observer.disconnect();for(const event of ['play','loadedmetadata','loadstart'])root.removeEventListener(event,this.discover,true);this.observers.delete(root);this.walkedRoots.delete(root);this.walkDeferred.delete(root);}
  return changed;
 }
 fromEvent(event){
  for(const node of event.composedPath?.()||[])if(this.ids.has(node))return node;
  const x=event.clientX,y=event.clientY;if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  const hits=[...this.videos.values()].filter(video=>{const r=video.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;});
  return hits.length===1?hits[0]:null;
 }
 snapshot(states,interactions,{details=false,activeId=null}={}){
  this.prune();const items=[],view=this.document.defaultView;
  for(const [id,video]of this.videos){
   const rect=video.getBoundingClientRect(),style=view.getComputedStyle(video);
   const visible=rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<view.innerHeight&&rect.left<view.innerWidth&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity!=='0';
   const fullscreen=this.document.fullscreenElement===video||this.document.fullscreenElement?.contains(video)||false;
   const signature=mediaSignature(video),cached=this.titleCache.get(video);
   let title=cached?.title;
   if(details||id===activeId){if(details||!cached||cached.key!==signature){title=mediaTitle(video,{document:this.document,index:items.length,total:this.videos.size});this.titleCache.set(video,{key:signature,title});}}
   else if(cached?.key!==signature)title='';
   title=title||video.getAttribute('title')||`影片 ${items.length+1}`;
   const state=states.get(id);
   const visibleArea=visible?Math.max(0,Math.min(view.innerWidth,rect.right)-Math.max(0,rect.left))*Math.max(0,Math.min(view.innerHeight,rect.bottom)-Math.max(0,rect.top)):0;
   items.push({id,title:String(title).trim().slice(0,200),visible,visibleArea,area:Math.round(rect.width*rect.height),fullscreen,playing:!video.paused&&!video.ended,lastPlayedAt:Number(video.getAttribute('data-video-control-last-played'))||0,interactedAt:interactions.get(video)||0,connected:video.isConnected,videoQuality:video.videoWidth&&video.videoHeight?Math.min(video.videoWidth,video.videoHeight):video.videoHeight||0,videoHeight:video.videoHeight||0,...state?.rate.snapshot(),quality:state?.quality||{status:'pending'}});
  }
  return items;
 }
 dispose(){this.disposed=true;clearTimeout(this.walkTimer);this.walkTimer=null;this.walkQueue=[];this.walkDeferred.clear();this.mutationQueue=[];this.pendingMutationNodes=0;this.pendingMutationRecords=0;for(const [root,observer]of this.observers){observer.disconnect();for(const event of ['play','loadedmetadata','loadstart'])root.removeEventListener(event,this.discover,true);}this.observers.clear();for(const [id,video]of this.videos){this.ids.delete(video);this.clearIdentity(id,video);}this.videos.clear();}
}
