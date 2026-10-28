import test from 'node:test';
import assert from 'node:assert/strict';
import {isMediaPresent,pageMediaPresence} from '../extension/media-presence.js';

const identitySymbol=Symbol.for('video-pocket.identities');
const selectionSymbol=Symbol.for('video-pocket.selection');
const observerSymbol=Symbol.for('video-pocket.mediaObserver');
const evidenceSymbol=Symbol.for('video-pocket.sourceEvidence');
const symbols=[identitySymbol,selectionSymbol,observerSymbol,evidenceSymbol];

function installWorld({documentMock,hostname='www.youtube.com',styles=new Map()}={}){
 const previousDocument=globalThis.document,previousFetch=globalThis.fetch,previousLocation=globalThis.location,previousGetComputedStyle=globalThis.getComputedStyle;
 const previousSymbols=symbols.map(symbol=>({symbol,had:Object.prototype.hasOwnProperty.call(globalThis,symbol),value:globalThis[symbol]}));
 globalThis.document=documentMock;
 globalThis.location={hostname,href:`https://${hostname}/`};
 globalThis.getComputedStyle=node=>styles.get(node)||{display:'block',visibility:'visible',contentVisibility:'visible',opacity:'1'};
 return {restore(){
  if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  if(previousFetch===undefined)delete globalThis.fetch;else globalThis.fetch=previousFetch;
  if(previousLocation===undefined)delete globalThis.location;else globalThis.location=previousLocation;
  if(previousGetComputedStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previousGetComputedStyle;
  for(const {symbol,had,value} of previousSymbols){if(had)globalThis[symbol]=value;else delete globalThis[symbol];}
 }};
}

function video({documentMock,isConnected=true,rect={left:0,top:0,width:160,height:90},preview=null,paused=false,checkVisibility=()=>true}={}){
 return {ownerDocument:documentMock,isConnected,paused,parentElement:preview,closest:()=>preview,checkVisibility,getBoundingClientRect:()=>rect};
}

test('retired videos and videos owned by another document are absent',()=>{
 const documentMock={},target={document:documentMock,location:{hostname:'example.com'}};
 const active=video({documentMock}),retired=video({documentMock,isConnected:false}),foreign=video({documentMock:{}});
 assert.equal(isMediaPresent(active,target),true);
 assert.equal(isMediaPresent(retired,target),false);
 assert.equal(isMediaPresent(foreign,target),false);
});

test('hidden YouTube preview players are excluded',()=>{
 const documentMock={},styles=new Map(),target={document:documentMock,location:{hostname:'www.youtube.com'},getComputedStyle(node){return styles.get(node)||{display:'block',visibility:'visible',contentVisibility:'visible',opacity:'1'};}};
 const preview={},player=video({documentMock,preview});styles.set(preview,{display:'none',visibility:'visible',contentVisibility:'visible',opacity:'1'});
 assert.equal(isMediaPresent(player,target),false);
 assert.equal(isMediaPresent(video({documentMock,preview,checkVisibility:()=>false}),target),false);
});

test('paused and off-viewport YouTube preview players remain present when visible',()=>{
 const documentMock={},preview={},target={document:documentMock,location:{hostname:'m.youtube.com'},getComputedStyle:()=>({display:'block',visibility:'visible',contentVisibility:'visible',opacity:'1'})};
 const player=video({documentMock,preview,paused:true,rect:{left:4000,top:2200,width:160,height:90}});
 assert.equal(isMediaPresent(player,target),true);
});

test('non-YouTube players keep existing visibility behavior',()=>{
 const documentMock={},preview={},target={document:documentMock,location:{hostname:'www.tiktok.com'},getComputedStyle:()=>({display:'none',visibility:'hidden',contentVisibility:'hidden',opacity:'0'})};
 const player=video({documentMock,preview,paused:true,rect:{left:-5000,top:0,width:0,height:0},checkVisibility:()=>false});
 assert.equal(isMediaPresent(player,target),true);
});

test('page presence checks only requested current keys and never fetches',()=>{
 const documentMock={},styles=new Map();let queries=0,snapshots=0,fetches=0;
 documentMock.querySelectorAll=selector=>{assert.equal(selector,'video');queries++;return [domVideo,unrelated,retired,foreign,hidden];};
 const registered=video({documentMock}),observed=video({documentMock}),domVideo=video({documentMock}),unrelated=video({documentMock}),retired=video({documentMock,isConnected:false}),foreign=video({documentMock:{}}),preview={},hidden=video({documentMock,preview});
 styles.set(hidden,{display:'none',visibility:'visible',contentVisibility:'visible',opacity:'1'});
 const world=installWorld({documentMock,styles});
 try{
  globalThis.fetch=async()=>{fetches++;throw new Error('presence must not fetch');};
  globalThis[identitySymbol]={keys:new Map([[registered,'registered'],[observed,'observed'],[domVideo,'dom'],[unrelated,'unrequested'],[retired,'retired'],[foreign,'foreign'],[hidden,'hidden']])};
  globalThis[selectionSymbol]={videos:[registered]};
  globalThis[observerSymbol]={videosSnapshot(limit){assert.equal(limit,256);snapshots++;return [observed];},isPresent:player=>isMediaPresent(player,{document:documentMock,location:{hostname:'www.youtube.com'},getComputedStyle:node=>styles.get(node)||{display:'block',visibility:'visible',contentVisibility:'visible',opacity:'1'}})};
  const result=pageMediaPresence(['registered','observed','dom','retired','foreign','hidden']);
  assert.deepEqual(result,{checked:true,present:['registered','observed','dom']});
  assert.equal(queries,1);assert.equal(snapshots,1);assert.equal(fetches,0);
 }finally{world.restore();}
});

test('page presence reports unchecked when player identities are unavailable',()=>{
 let queries=0;const documentMock={querySelectorAll(){queries++;return [];}};const world=installWorld({documentMock});
 try{
  globalThis.fetch=async()=>{throw new Error('presence must not fetch');};
  assert.deepEqual(pageMediaPresence(['old-key']),{checked:false});
  assert.equal(queries,0);
 }finally{world.restore();}
});
