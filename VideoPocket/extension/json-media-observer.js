import {isBroadcastIdentityField,isMediaField,isMediaIdentityField,isMediaPayloadText,isMediaShapeField,isMediaMetadataField} from './media-schema.js';
const KEY=Symbol.for('video-pocket.json-metadata');
const MEDIA_KEY = isMediaMetadataField;
const MEDIA_CUE = key => isMediaField(key) || isMediaIdentityField(key) || isBroadcastIdentityField(key) || isMediaShapeField(key);
const LARGE_TEXT=256*1024;
const CONTAINER_KEY=/^(?:data|result|results|response|payload|props|player|config|attributes|metadata|item|items|entity|entities|legacy|graphql|body|value|source|video|media|files|assets|qualities|variants|video_info|videoInfo|videoDelivery.*)$/i;

// Copy metadata only. Revivers can introduce getters, cycles and native
// objects that were not present in the original JSON text.
function metadataCopy(value,{targeted=false}={}){
 const seen=new WeakSet();let remaining=4096,characters=0;
 const copy=(node,depth=0,probe=false,inMedia=false)=>{
  if(--remaining<0||depth>32)return;
  if(typeof node==='string'){if(characters+node.length>512*1024)return;characters+=node.length;return node;}
  if(node==null||typeof node==='boolean'||typeof node==='number')return node;
  if(typeof node!=='object'||seen.has(node))return;
  let proto;try{proto=Object.getPrototypeOf(node)}catch{return;}
  if(!Array.isArray(node)&&proto!==Object.prototype&&proto!==null)return;
  seen.add(node);const out=Array.isArray(node)?[]:Object.create(null);
  let keys;
  try{
   if(targeted&&Array.isArray(node)){
    const length=node.length;
    if(length>256){
     keys=[];
     for(let index=0;index<128;index++)keys.push(String(index));
     for(let index=Math.max(128,length-128);index<length;index++)keys.push(String(index));
    }else keys=Array.from({length},(_,index)=>String(index));
   }else keys=Object.keys(node);
  }catch{return;}
  if(keys.length>4096){
   const priority=keys.filter(key=>CONTAINER_KEY.test(key)||MEDIA_KEY(key));
   const rest=keys.filter(key=>!CONTAINER_KEY.test(key)&&!MEDIA_KEY(key));
   keys=[...new Set([...priority.slice(0,4096),...rest.slice(0,Math.max(0,4096-priority.length))])];
  }
  for(const key of keys){
   if(remaining<=0)break;
   const field=Object.getOwnPropertyDescriptor(node,key);
   if(!field||!Object.hasOwn(field,'value'))continue;
   const childValue=field.value;
   const keyRelevant=MEDIA_KEY(key)||CONTAINER_KEY.test(key);
   const relevant=!targeted||Array.isArray(node)||keyRelevant;
   const childObject=childValue&&typeof childValue==='object';
   // Probe a few generic nesting levels to find an unfamiliar site's media
   // object, but never retain unrelated primitive feed/cache fields.
   if(targeted&&!relevant&&!((probe||inMedia)&&childObject&&(!Array.isArray(childValue)||childValue.length<=256)))continue;
   if(targeted&&Array.isArray(childValue)&&!keyRelevant&&(!(probe||inMedia)||childValue.length>256))continue;
   characters+=key.length;
   const child=copy(childValue,depth+1,targeted&&depth<6,inMedia||isMediaField(key));
   const nonempty=child!==undefined&&childObject&&(Array.isArray(child)
    ?child.some(item=>item&&typeof item==='object'&&Object.keys(item).length)
    :Object.keys(child).length);
   if(child!==undefined&&(!targeted||relevant||nonempty))out[key]=child;
  }
  return out;
 };
 return copy(value,0,true);
}

function hasMediaCue(value,seen=new WeakSet(),depth=0){
 if(!value||typeof value!=='object'||seen.has(value)||depth>12)return false;
 seen.add(value);
 let keys;try{keys=Object.keys(value)}catch{return false;}
 for(const key of keys){
  const field=Object.getOwnPropertyDescriptor(value,key);
  if(!field||!Object.hasOwn(field,'value'))continue;
  if(MEDIA_CUE(key)&&((typeof field.value==='string'&&field.value.length<=16384)||typeof field.value==='number'))return true;
  if(hasMediaCue(field.value,seen,depth+1))return true;
 }
 return false;
}

// Shared with deferred response observers so queued metadata uses exactly the
// same bounded copy and media-cue decision as JSON.parse interception.
export {metadataCopy as copyMediaMetadata, hasMediaCue as hasMediaMetadataCue};

export function observeJsonMetadata(target,onValue,{now=()=>Date.now(),maxPerSecond=20}={}){
 if(target[KEY]?.dispose)return target[KEY];
 const owner=target.JSON,original=owner?.parse;
 const counts={observed:0,oversized:0,throttled:0,errors:0};
 let disposed=false,active=false,windowStart=0,windowCount=0;
 const noop={dispose(){},stats:()=>({...counts})};
 if(typeof original!=='function')return noop;
 const parse=new Proxy(original,{apply(native,receiver,args){
  const value=Reflect.apply(native,receiver,args),text=args[0];
  if(disposed||active)return value;
  try{
   // Do not coerce input twice or scan every application settings object.
   if(typeof text!=='string'||text.length<16)return value;
   // Small payloads retain the cheap marker gate. Large payloads are already
   // parsed by the native parser; scanning the entire text again is needless.
   if(text.length<=LARGE_TEXT&&!isMediaPayloadText(text))return value;
   const time=now();if(time-windowStart>=1000||time<windowStart){windowStart=time;windowCount=0;}
   if(windowCount>=maxPerSecond){counts.throttled++;return value;}
   windowCount++;active=true;
   const metadata=metadataCopy(value,{targeted:text.length>LARGE_TEXT});
   const usable=metadata!==undefined&&(text.length<=LARGE_TEXT||hasMediaCue(metadata));
   if(usable){onValue(metadata);counts.observed++;}
   else counts.oversized++;
  }catch{counts.errors++;}
  finally{active=false;}
  return value;
 }});
 const api={stats:()=>({...counts}),dispose(){
  disposed=true;
  if(owner.parse===parse)owner.parse=original;
  if(target[KEY]===api)delete target[KEY];
 }};
 try{owner.parse=parse;target[KEY]=api;}catch{try{api.dispose();}catch{}return noop;}
 return api;
}
