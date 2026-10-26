import {validRate} from './settings.js';
import {nativeRateFromEvent} from './native-rate-intent.js';

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
 constructor(document,{getRecords=()=>[],now}={}){
  this.document=document;this.getRecords=getRecords;
  this.now=typeof now==='function'?now:()=>{
   try{const value=document?.defaultView?.performance?.now?.();if(Number.isFinite(value))return value;}catch{}
   return Date.now();
  };
  this.proofs=[];this.pointerOwner=null;this.started=false;
  this.onInput=event=>this._capture(event);
 }
 start(){
  if(this.started||!this.document?.addEventListener)return false;
  this.started=true;
  for(const type of ['pointerdown','click','input','change','keydown'])this.document.addEventListener(type,this.onInput,true);
  return true;
 }
 dispose(){
  if(this.started){for(const type of ['pointerdown','click','input','change','keydown'])this.document.removeEventListener(type,this.onInput,true);}
  this.started=false;this.proofs=[];this.pointerOwner=null;
 }
 consume(video,info){
  if(!video||!this.started||info?.origin!=='user'||info.status!=='ready')return false;
  const kind=info.evidence==='native-rate-option'?'choice':info.evidence==='direct-key-write'?'key':null;
  if(!kind||!validRate(info.actualRate)||!validRate(info.attemptedRate)||!same(info.actualRate,info.attemptedRate))return false;
  const now=this.now();this._prune(now);
  const record=this._records().find(item=>item.video===video);
  if(!record||typeof info.mediaKey!=='string'||record.mediaKey!==info.mediaKey)return false;
  const index=this.proofs.findIndex(proof=>proof.kind===kind&&proof.video===video&&proof.mediaKey===record.mediaKey&&proof.expires>=now&&(proof.rate===null||same(proof.rate,info.attemptedRate)));
  if(index<0)return false;
  this.proofs.splice(index,1);
  let currentRate;
  try{currentRate=Number(video.playbackRate);}catch{return false;}
  return validRate(currentRate)&&same(currentRate,info.actualRate);
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
 }
 _capture(event){
  if(!event?.isTrusted)return;
  const path=pathOf(event),records=this._records(),now=this.now();
  if(event.type==='pointerdown'){
   const owner=editablePath(path)?null:this._resolveOwner(path,records);
   this.pointerOwner=owner?{video:owner.video,mediaKey:owner.mediaKey,at:now}:null;
   return;
  }
  const exactRate=nativeRateFromEvent(event);
  if(exactRate!==null){
   const owner=this._resolveOwner(path,records,{allowRecentPointer:true,keydown:event.type==='keydown'});
   if(owner)this._addProof({kind:'choice',rate:exactRate,video:owner.video,mediaKey:owner.mediaKey,expires:now+USER_TOKEN_WINDOW});
   return;
  }
  if(event.type!=='keydown'||BLOCKED_KEYS.has(String(event.key||''))||editablePath(path))return;
  const owner=this._resolveOwner(path,records,{allowRecentPointer:true,keydown:true});
  if(owner){
   const proof=this._addProof({kind:'key',rate:null,video:owner.video,mediaKey:owner.mediaKey,expires:now+USER_TOKEN_WINDOW});
   // MAIN-world direct-key observations are emitted by the setter in the same
   // keydown dispatch. A recent key must not authorize a later page event.
   queueMicrotask(()=>{const index=this.proofs.indexOf(proof);if(index>=0)this.proofs.splice(index,1);});
  }
 }
}
