import {validRate} from './settings.js';
import {nativeRateIntentFromEvent} from './native-rate-intent.js';

const MAX_PROOFS=16,USER_TOKEN_WINDOW=1200,POINTER_WINDOW=2600,EPSILON=0.001;
const BLOCKED_KEYS=new Set([
 ' ','Space','Spacebar','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
 'Home','End','PageUp','PageDown','j','J','k','K','l','L','m','M','f','F',
 'c','C','t','T','w','W','n','N','MediaPlay','MediaPause','MediaStop','MediaPlayPause','MediaTrackNext','MediaTrackPrevious',
]);
const same=(a,b)=>typeof a==='number'&&Number.isFinite(a)&&typeof b==='number'&&Number.isFinite(b)&&Math.abs(a-b)<=EPSILON;
const tagOf=node=>{try{return String(node?.tagName||'').toUpperCase();}catch{return '';}};
const pathOf=event=>{
 try{const path=event?.composedPath?.();if(Array.isArray(path)&&path.length)return path;}catch{}
 return event?.target?[event.target]:[];
};
function editablePath(path){
 for(const node of path){
  if(!node||typeof node!=='object')continue;
  const tag=tagOf(node),role=String(node.getAttribute?.('role')||'').toLowerCase();
  try{if(node.isContentEditable)return true;}catch{}
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)||['textbox','combobox','slider'].includes(role))return true;
 }
 return false;
}

/**
 * Keeps a short, one-use proof of actual browser input in the isolated world.
 * Page-world CustomEvents never create a proof; generic pointer input only
 * identifies a likely media owner for a later exact speed choice.
 */
export class TrustedRateInput{
 constructor(document,{getRecords=()=>[],onSliderInput=()=>{},now}={}){
  this.document=document;this.getRecords=getRecords;this.onSliderInput=onSliderInput;
  this.now=typeof now==='function'?now:()=>{
   try{const value=document?.defaultView?.performance?.now?.();if(Number.isFinite(value))return value;}catch{}
   return Date.now();
  };
  this.proofs=[];this.pending=[];this.pendingTimer=null;this.inputs=new WeakMap();this.pointerOwner=null;this.started=false;
  this.onInput=event=>this._capture(event);
 }
 start(){
  if(this.started||!this.document?.addEventListener)return false;
  this.started=true;
  this.surfaces=[...new Set([this.document.defaultView,this.document].filter(surface=>surface?.addEventListener))];
  for(const surface of this.surfaces)for(const type of ['pointerdown','pointermove','pointerup','click','input','change','keydown'])surface.addEventListener(type,this.onInput,true);
  return true;
 }
 dispose(){
  if(this.started){for(const surface of this.surfaces)for(const type of ['pointerdown','pointermove','pointerup','click','input','change','keydown'])surface.removeEventListener(type,this.onInput,true);}
  clearTimeout(this.pendingTimer);this.pendingTimer=null;this.pending=[];
  this.started=false;this.proofs=[];this.pointerOwner=null;
 }
 verify(video,info,accept){
  if(this.consume(video,info)){accept();return true;}
  if(!this.started||info?.origin!=='user'||info.status!=='ready'||!validRate(info.actualRate)||!same(info.actualRate,info.attemptedRate))return false;
  // A player's earlier capture listener can write before our trusted-input
  // listener runs. Keep this observation only until this event turn ends.
  this.pending.push({video,info,accept});if(this.pending.length>MAX_PROOFS)this.pending.shift();
  if(this.pendingTimer===null)this.pendingTimer=setTimeout(()=>{this.pendingTimer=null;this.pending=[];},0);
  return false;
 }
 consume(video,info){
  if(!video||!this.started||info?.origin!=='user'||info.status!=='ready')return false;
  const kind=info.evidence==='native-rate-option'?'choice':info.evidence==='direct-key-write'?'key':info.evidence==='native-rate-control'?'control':null;
  if(!kind||!validRate(info.actualRate)||!validRate(info.attemptedRate)||!same(info.actualRate,info.attemptedRate))return false;
  const now=this.now();this._prune(now);
  const record=this._records().find(item=>item.video===video);
  if(!record||typeof info.mediaKey!=='string'||record.mediaKey!==info.mediaKey)return false;
  const index=this.proofs.findIndex(proof=>proof.kind===kind&&proof.video===video&&proof.mediaKey===record.mediaKey&&proof.expires>=now&&(proof.kind==='choice'||proof.event?.eventPhase>0)&&(proof.rate===null||same(proof.rate,info.attemptedRate)));
  if(index<0)return false;
  let currentRate;
  try{currentRate=Number(video.playbackRate);}catch{return false;}
  if(!validRate(currentRate)||!same(currentRate,info.actualRate))return false;
  this.proofs.splice(index,1);return true;
 }
 _records(){
  try{
   const records=this.getRecords();
   return Array.isArray(records)?records.filter(record=>record?.video&&typeof record.video==='object'):[];
  }catch{return [];}
 }
 _prune(now=this.now()){
  const records=this._records();
  this.proofs=this.proofs.filter(proof=>proof.expires>=now&&records.some(record=>record.video===proof.video&&record.mediaKey===proof.mediaKey));
  if(this.pointerOwner&&(!records.some(record=>record.video===this.pointerOwner.video&&record.mediaKey===this.pointerOwner.mediaKey)||now-this.pointerOwner.at>POINTER_WINDOW))this.pointerOwner=null;
 }
 _resolveOwner(path,records,{allowRecentPointer=false,keydown=false}={}){
  for(const node of path){
   if(!node||typeof node!=='object'||node===this.document||node===this.document?.defaultView)continue;
   if(['BODY','HTML'].includes(tagOf(node)))continue;
   const direct=records.find(record=>record.video===node);if(direct)return direct;
  }
  for(const node of path){
   if(!node||typeof node!=='object'||node===this.document||node===this.document?.defaultView)continue;
   if(['BODY','HTML'].includes(tagOf(node)))continue;
   const scope=[];
   for(const record of records){
    try{if(typeof node.contains==='function'&&node.contains(record.video))scope.push(record);}catch{}
   }
   if(scope.length===1)return scope[0];
   if(scope.length>1){
    const selected=scope.filter(record=>record.selected);
    if(selected.length===1)return selected[0];
    if(allowRecentPointer&&this._validPointerOwner())return records.find(record=>record.video===this.pointerOwner.video)||null;
    return null;
   }
  }
  if(allowRecentPointer&&this._validPointerOwner())return records.find(record=>record.video===this.pointerOwner.video)||null;
  if(keydown){const selected=records.filter(record=>record.selected);if(selected.length===1)return selected[0];}
  return null;
 }
 _validPointerOwner(){
  if(!this.pointerOwner)return false;
  const now=this.now();this._prune(now);
  return !!this.pointerOwner&&now-this.pointerOwner.at<=POINTER_WINDOW;
 }
 _addProof(proof){
  this._prune();this.proofs.push(proof);
  if(this.proofs.length>MAX_PROOFS)this.proofs.splice(0,this.proofs.length-MAX_PROOFS);
  const waiting=this.pending;this.pending=[];
  for(const item of waiting){if(this.consume(item.video,item.info))item.accept();else this.pending.push(item);}
  return proof;
 }
 _capture(event){
  if(!event?.isTrusted)return;
  if(event.type==='pointermove'&&!(Number(event.buttons)>0))return;
  const intent=nativeRateIntentFromEvent(event),signature=intent?String(intent.rate):event.type==='keydown'?'key':'pointer';
  if(event.type==='pointermove'&&!intent)return;
  if(this.inputs.get(event)===signature)return;this.inputs.set(event,signature);
  const path=pathOf(event),records=this._records(),now=this.now();
  if(event.type==='pointerdown'&&!intent){
   const owner=editablePath(path)?null:this._resolveOwner(path,records);
   this.pointerOwner=owner?{video:owner.video,mediaKey:owner.mediaKey,at:now}:null;
   return;
  }
  if(intent){
   const owner=this._resolveOwner(path,records,{allowRecentPointer:true,keydown:event.type==='keydown'});
   if(owner){
    this._addProof({kind:intent.rate===null?'control':'choice',rate:intent.rate,event,video:owner.video,mediaKey:owner.mediaKey,expires:now+USER_TOKEN_WINDOW});
    if(event.type==='input'&&validRate(intent.rate)&&path.slice(0,8).some(node=>String(node?.getAttribute?.('role')||'').toLowerCase()==='slider'||tagOf(node)==='INPUT'&&String(node?.getAttribute?.('type')||node?.type||'').toLowerCase()==='range'))this.onSliderInput({video:owner.video,mediaKey:owner.mediaKey,rate:intent.rate});
   }
   return;
  }
  if(event.type!=='keydown'||BLOCKED_KEYS.has(String(event.key||''))||editablePath(path))return;
  const owner=this._resolveOwner(path,records,{allowRecentPointer:true,keydown:true});
  if(owner){
   const proof=this._addProof({kind:'key',rate:null,event,video:owner.video,mediaKey:owner.mediaKey,expires:now+USER_TOKEN_WINDOW});
   // Microtasks can run between native event listeners. The phase check in
   // consume keeps this proof scoped to dispatch; discard it after this turn.
   setTimeout(()=>{const index=this.proofs.indexOf(proof);if(index>=0)this.proofs.splice(index,1);},0);
  }
 }
}
