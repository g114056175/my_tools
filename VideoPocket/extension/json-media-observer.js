const KEY=Symbol.for('video-pocket.json-metadata');
const MARKERS=/"(?:videoDelivery\w*|video_versions|video_url|video_dash_manifest|dash_manifest(?:_xml_string)?|playable_url(?:_quality_hd|_dash)?|browser_native_(?:sd|hd)_url|playAddr|play_addr|downloadAddr|download_addr|qualities|contentUrl|progressive)"\s*:/i;

// Copy metadata only. Revivers can introduce getters, cycles and native
// objects that were not present in the original JSON text.
function metadataCopy(value){
 const seen=new WeakSet();let remaining=4096,characters=0,truncated=false;
 const copy=(node,depth=0)=>{
  if(--remaining<0||depth>32){truncated=true;return;}
  if(typeof node==='string'){characters+=node.length;if(characters>512*1024){truncated=true;return;}return node;}
  if(node==null||typeof node==='boolean'||typeof node==='number')return node;
  if(typeof node!=='object'||seen.has(node))return;
  const proto=Object.getPrototypeOf(node);
  if(!Array.isArray(node)&&proto!==Object.prototype&&proto!==null)return;
  seen.add(node);const out=Array.isArray(node)?[]:Object.create(null);
  const keys=Object.keys(node);
  if(keys.length>4096){truncated=true;return;}
  for(const key of keys){
   if(truncated)break;
   const field=Object.getOwnPropertyDescriptor(node,key);
   if(!field||!Object.hasOwn(field,'value'))continue;
   characters+=key.length;
   const child=copy(field.value,depth+1);if(child!==undefined)out[key]=child;
  }
  return out;
 };
 const result=copy(value);return truncated?undefined:result;
}

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
   if(text.length>1024*1024){counts.oversized++;return value;}
   if(!MARKERS.test(text))return value;
   const time=now();if(time-windowStart>=1000||time<windowStart){windowStart=time;windowCount=0;}
   if(windowCount>=maxPerSecond){counts.throttled++;return value;}
   windowCount++;active=true;
   const metadata=metadataCopy(value);
   if(metadata!==undefined){onValue(metadata);counts.observed++;}
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
