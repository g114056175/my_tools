import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaRegistry} from '../src/media-registry.js';

class FakeMutationObserver{
 constructor(callback,observers){this.callback=callback;this.observers=observers;this.target=null;this.active=true;observers.add(this);}
 observe(target){this.target=target;this.active=true;this.observers.add(this);}
 disconnect(){this.active=false;this.observers.delete(this);}
}

class FakeNode{
 constructor(tag='div',nodeType=1,document=null){this.tagName=nodeType===1?tag.toUpperCase():undefined;this.nodeType=nodeType;this.ownerDocument=document;this.children=[];this.parentNode=null;this.attributes=new Map();this.listeners=new Map();this.paused=true;this.ended=false;}
 get childNodes(){return this.children;}
 get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
 get id(){return this.getAttribute('id')||'';}
 set id(value){this.setAttribute('id',value);}
 get isConnected(){
  if(this.nodeType===9)return true;
  if(this.nodeType===11)return !!this.host?.isConnected;
  let node=this.parentNode;
  while(node){if(node.nodeType===9)return true;if(node.nodeType===11)return !!node.host?.isConnected;node=node.parentNode;}
  return false;
 }
 append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}return nodes;}
 remove(node){const index=this.children.indexOf(node);if(index>=0){this.children.splice(index,1);node.parentNode=null;}return node;}
 contains(node){if(node===this)return true;for(const child of this.children)if(child.contains(node))return true;return false;}
 getRootNode(){let node=this;while(node.parentNode)node=node.parentNode;return node;}
 getAttribute(name){return this.attributes.get(name)??null;}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 removeAttribute(name){this.attributes.delete(name);}
 closest(){return null;}
 addEventListener(type,listener){let list=this.listeners.get(type);if(!list)this.listeners.set(type,list=[]);if(!list.includes(listener))list.push(listener);}
 removeEventListener(type,listener){const list=this.listeners.get(type)||[];this.listeners.set(type,list.filter(item=>item!==listener));}
 dispatch(type,event){for(const listener of this.listeners.get(type)||[])listener(event);}
 querySelectorAll(selector){
  const result=[];const visit=node=>{for(const child of node.children){if(selector==='video'&&child.tagName==='VIDEO')result.push(child);visit(child);}};visit(this);return result;
 }
 attachShadow(){const root=new FakeNode(undefined,11,this.ownerDocument);root.host=this;this.shadowRoot=root;return root;}
}

class FakeDocument extends FakeNode{
 constructor(observers){super(undefined,9,null);this.walkerRoots=[];this.observers=observers;this.defaultView={innerWidth:1000,innerHeight:800};this.location={href:'https://example.test/'};}
 createElement(tag){return new FakeNode(tag,1,this);}
 createTreeWalker(root){
  this.walkerRoots.push(root);const stack=[...(root.children||[])].reverse();
  return {nextNode(){const node=stack.pop();if(!node)return null;for(let index=node.children.length-1;index>=0;index--)stack.push(node.children[index]);return node;}};
 }
}

function fixture(t){
 const observers=new Set(),prior=globalThis.MutationObserver;
 globalThis.MutationObserver=class extends FakeMutationObserver{constructor(callback){super(callback,observers);}};
 t.after(()=>{globalThis.MutationObserver=prior;for(const observer of [...observers])observer.disconnect();});
 const document=new FakeDocument(observers),added=[],changes=[];
 const registry=new MediaRegistry(document,(video,id)=>added.push({video,id}),()=>changes.push(1));
 const notify=(root,nodes=[],removedNodes=[])=>{
  const record={target:root,addedNodes:nodes,removedNodes};
  for(const observer of [...observers])if(observer.active&&observer.target?.contains(root))observer.callback([record],[observer]);
 };
 return {document,registry,observers,added,changes,notify};
}

function drain(registry,limit=10000){
 for(let index=0;index<limit;index++){
  if(!registry.walkQueue.length&&!registry.walkDeferred.size&&!registry.mutationQueue.length)return;
  registry.runWalk(256,1000,false);
 }
 assert.fail('MediaRegistry work did not drain');
}

test('large added-node batches retain an incremental cursor without rescanning the document',t=>{
 const {document,registry,notify,added}=fixture(t);
 document.append(...Array.from({length:8000},()=>document.createElement('article')));
 drain(registry);
 const initialDocumentWalks=document.walkerRoots.filter(root=>root===document).length;
 const articles=Array.from({length:2000},()=>document.createElement('article'));document.append(...articles);notify(document,articles);
 assert.equal(registry.mutationQueue.length,1);assert.equal(registry.pendingMutationNodes,2000);
 registry.runWalk(64,1000,false);
 assert.ok(registry.pendingMutationNodes>0&&registry.pendingMutationNodes<2000,'one walk batch advances only part of the mutation cursor');
 assert.equal(document.walkerRoots.filter(root=>root===document).length,initialDocumentWalks,'the overflow path must not enqueue a document rescan');
 drain(registry);
 assert.equal(registry.pendingMutationNodes,0);assert.equal(registry.walkDeferred.size,0);
 assert.equal(document.walkerRoots.filter(root=>root===document).length,initialDocumentWalks);
 assert.equal(added.length,0);
 const futureVideo=document.createElement('video');articles[0].append(futureVideo);notify(document,[futureVideo]);drain(registry);
 assert.equal(added.length,1);assert.equal(added[0].video,futureVideo,'an empty container remains covered by the document observer');
 registry.dispose();
});

test('new deep containers and multiple open shadow roots discover existing and later videos',t=>{
 const {document,registry,notify,added,observers}=fixture(t);
 const outer=document.createElement('x-outer'),outerRoot=outer.attachShadow(),section=document.createElement('section'),inner=document.createElement('x-inner'),innerRoot=inner.attachShadow(),deep=document.createElement('div'),last=document.createElement('x-last'),lastRoot=last.attachShadow(),video=document.createElement('video');
 deep.append(last);lastRoot.append(video);innerRoot.append(deep);section.append(inner);outerRoot.append(section);document.append(outer);
 notify(document,[outer]);drain(registry);
 assert.equal(added.length,1);assert.equal(added[0].video,video);assert.equal(observers.size,4,'document and all three open roots are observed');
 const later=document.createElement('div'),laterVideo=document.createElement('video');later.append(laterVideo);lastRoot.append(later);notify(lastRoot,[later]);drain(registry);
 assert.equal(added.length,2);assert.equal(added[1].video,laterVideo);
 registry.dispose();
});

test('play and loadedmetadata discover immediately; removals prune and disposal stops discovery',t=>{
 const {document,registry,observers,added,notify}=fixture(t);
 const playing=document.createElement('video'),metadata=document.createElement('video');document.append(playing,metadata);
 const playEvent={type:'play',composedPath:()=>[playing]};document.dispatch('play',playEvent);
 const metadataEvent={type:'loadedmetadata',composedPath:()=>[metadata]};document.dispatch('loadedmetadata',metadataEvent);
 assert.equal(added.length,2);
 const removed=[];registry.onRemove=(id,video)=>removed.push(video);document.remove(playing);registry.prune();
 assert.deepEqual(removed,[playing]);assert.equal(registry.videos.has(added[0].id),false);
 registry.dispose();
 const afterDispose=document.createElement('video');document.append(afterDispose);notify(document,[afterDispose]);document.dispatch('play',{type:'play',composedPath:()=>[afterDispose]});
 assert.equal(added.length,2);assert.equal(observers.size,0);
});

test('thumbnail previews never receive identities, playback stamps or controllers',t=>{
 const {document,registry,added}=fixture(t);document.location.href='https://www.youtube.com/watch?v=A';document.defaultView.location=document.location;
 const main=document.createElement('video'),preview=document.createElement('video');
 main.closest=selector=>selector.split(',').includes('#movie_player')?{}:null;
 preview.closest=selector=>selector.split(',').includes('ytd-video-preview')?{}:null;
 document.append(main,preview);registry.scan(document,true);
 document.dispatch('play',{type:'play',composedPath:()=>[preview]});
 assert.deepEqual(added.map(item=>item.video),[main]);
 assert.equal(preview.getAttribute('data-video-control-id'),null);assert.equal(preview.getAttribute('data-video-control-last-played'),null);
 assert.equal(registry.fromEvent({composedPath:()=>[preview]}),null);registry.dispose();
});

test('a registered element moved into a preview loses control and can later become primary again',t=>{
 const {document,registry,added}=fixture(t);document.location.href='https://www.bilibili.com/video/BV1main';document.defaultView.location=document.location;
 const item=document.createElement('video'),removed=[];let preview=false;
 item.closest=selector=>preview&&selector.split(',').includes('.bili-video-card')?{}:null;
 registry.onRemove=(id,video)=>removed.push(video);document.append(item);registry.add(item);const first=registry.ids.get(item);
 preview=true;assert.equal(registry.fromEvent({composedPath:()=>[item]}),null);registry.prune();
 assert.deepEqual(removed,[item]);assert.equal(registry.videos.size,0);assert.equal(item.getAttribute('data-video-control-id'),null);
 preview=false;registry.add(item);assert.equal(added.length,2);assert.notEqual(registry.ids.get(item),first);registry.dispose();
});

test('mutation backlog is capped and an overflow fallback still finds media',t=>{
 const {document,registry,notify,added}=fixture(t);drain(registry);
 const nodes=Array.from({length:4097},()=>document.createElement('article')),video=document.createElement('video');nodes.at(-1).append(video);document.append(...nodes);
 notify(document,nodes);
 assert.equal(registry.mutationQueue.length,0);assert.equal(registry.walkDeferred.has(document),true);
 drain(registry);
 assert.equal(added.length,1);assert.equal(added[0].video,video);
 assert.equal(document.walkerRoots.filter(root=>root===document).length,2,'bounded overflow falls back to one complete document walk');
 registry.dispose();
});

test('continuous mutation callbacks stay within queue limits and coalesce fallback work',t=>{
 const {document,registry,notify}=fixture(t);drain(registry);
 const nodes=Array.from({length:70},()=>document.createElement('article'));document.append(...nodes);
 for(const node of nodes)notify(document,[node]);
 assert.equal(registry.mutationQueue.length,64);assert.equal(registry.pendingMutationNodes,64);
 assert.equal(registry.pendingMutationRecords,64);assert.equal(registry.walkDeferred.size,1);
 drain(registry);
 assert.equal(registry.mutationQueue.length,0);assert.equal(registry.pendingMutationNodes,0);
 registry.dispose();
});

test('explicit deep scans continue past the eager first 64 videos',t=>{
 const {document,registry,added}=fixture(t);
 const videos=Array.from({length:100},()=>document.createElement('video'));document.append(...videos);
 registry.scan(document,true);drain(registry);
 assert.equal(added.length,100);
 registry.dispose();
});

test('disposal clears only its own registry identity and preserves first-load history',t=>{
 const {document,registry}=fixture(t),video=document.createElement('video');document.append(video);registry.add(video);
 video.setAttribute('data-video-control-initialized','media-A');registry.dispose();
 assert.equal(video.getAttribute('data-video-control-id'),null);
 assert.equal(video.getAttribute('data-video-control-registry'),null);
 assert.equal(video.getAttribute('data-video-control-initialized'),'media-A');
 const old=new MediaRegistry(document,()=>{},()=>{},{owner:'old'});
 const current=new MediaRegistry(document,()=>{},()=>{},{owner:'current'});
 old.dispose();assert.equal(video.getAttribute('data-video-control-id'),current.ids.get(video));assert.equal(video.getAttribute('data-video-control-registry'),'current');
 current.dispose();assert.equal(video.getAttribute('data-video-control-id'),null);
});

test('pausing clears queued work, ignores unknown media events, and resumes discovery without duplicates',t=>{
 const {document,registry,observers,added,changes,notify}=fixture(t);
 const known=document.createElement('video');document.append(known);registry.add(known);
 known.setAttribute('data-video-control-initialized','media-known');
 const pendingNode=document.createElement('section');document.append(pendingNode);
 registry.queueMutations(document,[{addedNodes:[pendingNode]}]);
 assert.ok(registry.walkQueue.length>0);assert.ok(registry.mutationQueue.length>0);
 const documentObserver=registry.observers.get(document);
 registry.setExploring(false);
 assert.equal(registry.walkQueue.length,0);assert.equal(registry.walkDeferred.size,0);
 assert.equal(registry.mutationQueue.length,0);assert.equal(registry.pendingMutationNodes,0);assert.equal(registry.pendingMutationRecords,0);
 assert.equal(registry.walkTimer,null);assert.equal(documentObserver.active,false);assert.equal(observers.has(documentObserver),false);

 const unknown=document.createElement('video');
 document.dispatch('play',{type:'play',composedPath:()=>[unknown]});
 document.dispatch('loadedmetadata',{type:'loadedmetadata',composedPath:()=>[unknown]});
 assert.equal(added.length,1);assert.equal(changes.length,0);
 document.dispatch('play',{type:'play',composedPath:()=>[known]});
 document.dispatch('loadedmetadata',{type:'loadedmetadata',composedPath:()=>[known]});
 assert.equal(changes.length,2,'known media events still notify while exploration is paused');

 const lightVideo=document.createElement('video'),host=document.createElement('x-player'),shadow=host.attachShadow(),shadowVideo=document.createElement('video');
 shadow.append(shadowVideo);document.append(lightVideo,host);
 registry.setExploring(true);
 assert.equal(documentObserver.active,true);assert.equal(observers.has(documentObserver),true,'a disconnected observer can observe again');
 drain(registry);
 assert.equal(added.length,3);
 assert.equal(added.filter(item=>item.video===known).length,1);
 assert.equal(added.filter(item=>item.video===lightVideo).length,1);
 assert.equal(added.filter(item=>item.video===shadowVideo).length,1);
 assert.equal(registry.videos.size,3);assert.equal(registry.observers.has(shadow),true);
 assert.equal(known.getAttribute('data-video-control-initialized'),'media-known');
 notify(document,[lightVideo,host]);drain(registry);
 assert.equal(added.length,3,'resumed mutation delivery does not duplicate discovered media');
 registry.dispose();assert.equal(known.getAttribute('data-video-control-initialized'),'media-known');
});

test('disposed registries cannot resume exploration',t=>{
 const {document,registry,observers,added}=fixture(t);
 registry.setExploring(false);registry.dispose();
 registry.setExploring(true);
 const later=document.createElement('video');document.append(later);
 document.dispatch('play',{type:'play',composedPath:()=>[later]});
 assert.equal(registry.exploring,false);assert.equal(added.length,0);assert.equal(observers.size,0);
});

test('recreating a registry in the same document cannot reuse a previous target id',t=>{
 const {document,registry}=fixture(t),video=document.createElement('video');document.append(video);registry.add(video);
 const oldId=registry.ids.get(video);registry.dispose();
 const replacement=new MediaRegistry(document,()=>{},()=>{});const newId=replacement.ids.get(video);
 assert.ok(oldId&&newId);assert.notEqual(newId,oldId);replacement.dispose();
});
