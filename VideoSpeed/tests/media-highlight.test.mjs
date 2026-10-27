import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightMedia} from '../src/media-highlight.js';

const STATE_KEY = Symbol.for('video-control.media-highlight');
const IDENTITIES_KEY = Symbol.for('video-control.identities');
const SELECTION_KEY = Symbol.for('video-control.selection');
const MARKER_SELECTOR = '[data-video-control-media-highlight]';

class FakeNode {
 constructor(tagName,document,nodeType=1){
  this.tagName=nodeType===1?String(tagName).toUpperCase():undefined;this.nodeType=nodeType;this.ownerDocument=document;
  this.children=[];this.parentElement=null;this.attributes=new Map();this.style={};this.offsetParent=null;this.offsetWidth=1000;this.offsetHeight=800;
  this.scrollLeft=0;this.scrollTop=0;this.clientLeft=0;this.clientTop=0;this._textContent='';this.textContentWrites=0;
 }
 get isConnected(){let node=this;while(node){if(node.nodeType===9)return true;node=node.parentElement;}return false;}
 get textContent(){return this._textContent;}
 set textContent(value){this._textContent=String(value);this.textContentWrites++;}
 append(...nodes){for(const node of nodes){node.remove?.();node.parentElement=this;this.children.push(node);}return nodes;}
 remove(){if(!this.parentElement)return;const parent=this.parentElement;parent.children=parent.children.filter(node=>node!==this);this.parentElement=null;}
 contains(node){if(this===node)return true;return this.children.some(child=>child.contains(node));}
 getAttribute(name){return this.attributes.get(name)??null;}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 removeAttribute(name){this.attributes.delete(name);}
 matches(selector){return selector===MARKER_SELECTOR&&this.getAttribute('data-video-control-media-highlight')!==null;}
 querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children){if(child.matches?.(selector))found.push(child);visit(child);}};visit(this);return found;}
 getRootNode(){let node=this;while(node.parentElement)node=node.parentElement;return node;}
 getBoundingClientRect(){return this.rect||{left:0,top:0,width:640,height:360,right:640,bottom:360};}
}

class FakeDocument extends FakeNode {
 constructor(){
  super(undefined,null,9);this.ownerDocument=this;this.markerQueries=0;
  this.documentElement=new FakeNode('html',this);this.body=new FakeNode('body',this);this.documentElement.append(this.body);this.append(this.documentElement);
 }
 createElement(tagName){return new FakeNode(tagName,this);}
 querySelectorAll(selector){if(selector===MARKER_SELECTOR)this.markerQueries++;return this.documentElement.querySelectorAll(selector);}
}

function fixture(t){
 const documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 const stateDescriptor=Object.getOwnPropertyDescriptor(globalThis,STATE_KEY);
 const identitiesDescriptor=Object.getOwnPropertyDescriptor(globalThis,IDENTITIES_KEY);
 const selectionDescriptor=Object.getOwnPropertyDescriptor(globalThis,SELECTION_KEY);
 const document=new FakeDocument(),videos=[],keys=new Map();
 globalThis.document=document;delete globalThis[STATE_KEY];
 globalThis[IDENTITIES_KEY]={keys};globalThis[SELECTION_KEY]={videos};
 t.after(()=>{
  try{globalThis[STATE_KEY]?.clear?.();}catch{}
  for(const [key,descriptor]of [['document',documentDescriptor],[STATE_KEY,stateDescriptor],[IDENTITIES_KEY,identitiesDescriptor],[SELECTION_KEY,selectionDescriptor]]){
   if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
 });
 const addVideo=(id,host=document.createElement('div'))=>{
  if(!host.parentElement)document.body.append(host);
  const video=document.createElement('video');video.playbackRate=1;video.rect={left:20,top:30,width:640,height:360,right:660,bottom:390};host.append(video);
  videos.push(video);keys.set(video,id);return {video,host};
 };
 return {document,addVideo};
}

test('same video and media key reuse the connected frame and refresh its presentation',t=>{
 const {document,addVideo}=fixture(t),{video}=addVideo('media-1');
 assert.deepEqual(highlightMedia({mediaKey:'media-1',title:'Clip one',requestId:'request-1'}),{highlighted:true});
 const state=globalThis[STATE_KEY],frame=state.frame,rateWrites=state.rate.textContentWrites,markerQueries=document.markerQueries;
 video.rect={left:44,top:52,width:640,height:360,right:684,bottom:412};
 assert.deepEqual(highlightMedia({mediaKey:'media-1',title:'Clip updated',requestId:'request-2'}),{highlighted:true});
 assert.strictEqual(globalThis[STATE_KEY].frame,frame,'same target should keep the existing marker node');
 assert.equal(state.titleNode.textContent,'Clip updated');
 assert.equal(state.requestId,'request-2');
 assert.equal(frame.style.left,'44px','reused marker should be repainted against the current video bounds');
 assert.equal(state.rate.textContentWrites,rateWrites,'unchanged rate label should not recreate its text node');
 assert.equal(document.markerQueries,markerQueries,'same-target refresh should not search/remove orphan markers');
 assert.deepEqual(highlightMedia({clear:true,requestId:'request-1'}),{highlighted:false});
 assert.strictEqual(globalThis[STATE_KEY].frame,frame,'stale clear request must not remove a newer marker');
 assert.deepEqual(highlightMedia({renew:true,requestId:'request-2'}),{highlighted:true});
 assert.strictEqual(globalThis[STATE_KEY].frame,frame);
});

test('changed target removes old and orphan markers before creating one marker',t=>{
 const {document,addVideo}=fixture(t),first=addVideo('media-1'),second=addVideo('media-2');
 highlightMedia({mediaKey:'media-1',title:'First'});
 const firstFrame=globalThis[STATE_KEY].frame,queries=document.markerQueries;
 const orphan=document.createElement('div');orphan.setAttribute('data-video-control-media-highlight','orphan');document.body.append(orphan);

 assert.deepEqual(highlightMedia({mediaKey:'media-2',title:'Second'}),{highlighted:true});
 assert.equal(document.markerQueries,queries+1,'orphan cleanup should run once for the target change');
 const markers=document.querySelectorAll(MARKER_SELECTOR);
 assert.equal(markers.length,1);
 assert.notStrictEqual(markers[0],firstFrame);
 assert.equal(firstFrame.isConnected,false);
 assert.equal(orphan.isConnected,false);
 assert.equal(globalThis[STATE_KEY].video,second.video);
});

test('detached frame is recreated for the same target and explicit clear removes orphans',t=>{
 const {document,addVideo}=fixture(t),{video}=addVideo('media-1');
 highlightMedia({mediaKey:'media-1',title:'Clip'});
 const detached=globalThis[STATE_KEY].frame;detached.remove();
 const orphan=document.createElement('div');orphan.setAttribute('data-video-control-media-highlight','orphan');document.body.append(orphan);

 assert.deepEqual(highlightMedia({mediaKey:'media-1',title:'Clip'}),{highlighted:true});
 const replacement=globalThis[STATE_KEY].frame;
 assert.notStrictEqual(replacement,detached);
 assert.equal(detached.isConnected,false);
 assert.equal(orphan.isConnected,false);
 assert.equal(document.querySelectorAll(MARKER_SELECTOR).length,1);

 const lastOrphan=document.createElement('div');lastOrphan.setAttribute('data-video-control-media-highlight','orphan');document.body.append(lastOrphan);
 assert.deepEqual(highlightMedia({clear:true}),{highlighted:false});
 assert.equal(document.querySelectorAll(MARKER_SELECTOR).length,0);
 assert.equal(video.isConnected,true);
});
