const MIN_RATE=0.06,MAX_RATE=16;
const SOURCES=new Set(['command','default','native']);
const rateValue=value=>typeof value==='number'&&Number.isFinite(value)&&value>=MIN_RATE&&value<=MAX_RATE;
const revisionValue=value=>Number.isSafeInteger(value)&&value>=0;
const copy=state=>({lastRate:state.lastRate,rateRevision:state.rateRevision});
const stored=state=>({lastRate:state.lastRate,lastRateRevision:state.rateRevision});
const writeIdValue=value=>Number.isSafeInteger(value)&&value>0;
const sessionIdValue=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const senderKey=(sender,sessionId)=>JSON.stringify([sender.tab.id,sender.frameId,String(sender.documentId||''),sessionId]);

export function validRateWriteMessage(message){return !!message&&rateValue(message.rate)&&SOURCES.has(message.source)&&sessionIdValue(message.rateSessionId)&&writeIdValue(message.rateWriteId);}

export class RateWriteLedger{
 constructor(maxEntries=512){this.maxEntries=Number.isSafeInteger(maxEntries)&&maxEntries>0?maxEntries:512;this.entries=new Map();}
 begin(message,sender){
  if(!validRateWriteMessage(message)||!Number.isInteger(sender?.tab?.id)||!Number.isInteger(sender?.frameId))return null;
  const key=senderKey(sender,message.rateSessionId),writeId=message.rateWriteId;
  let entry=this.entries.get(key);
  if(entry){this.entries.delete(key);this.entries.set(key,entry);}
  if(entry&&writeId<entry.writeId)return {status:'stale',isCurrent:()=>false,complete:()=>false};
  if(entry&&writeId===entry.writeId&&(entry.rate!==message.rate||entry.source!==message.source))return {status:'conflict',isCurrent:()=>false,complete:()=>false};
  if(!entry||writeId>entry.writeId){
   entry={tabId:sender.tab.id,writeId,rate:message.rate,source:message.source,completed:false};
   this.entries.set(key,entry);
   while(this.entries.size>this.maxEntries)this.entries.delete(this.entries.keys().next().value);
  }
  const current=()=>this.entries.get(key)===entry&&entry.writeId===writeId;
  return {status:entry.completed?'completed':'pending',isCurrent:current,complete(){if(!current())return false;entry.completed=true;return true;}};
 }
 forgetTab(tabId){for(const [key,entry]of this.entries)if(entry.tabId===tabId)this.entries.delete(key);}
}

/** Serialize rate-memory reads and writes; only confirmed, typed rate choices are durable. */
export class RateMemory{
 constructor(storage){this.storage=storage;this.state=null;this.tail=Promise.resolve();}
 enqueue(operation){
  const result=this.tail.then(operation,operation);
  this.tail=result.then(()=>undefined,()=>undefined);
  return result;
 }
 async ensureLoaded(){
  if(this.state)return this.state;
  const data=await this.storage.get(['lastRate','lastRateRevision']);
  const hasRate=Object.hasOwn(data||{},'lastRate'),hasRevision=Object.hasOwn(data||{},'lastRateRevision');
  let state,seed=false;
  if(!hasRate&&!hasRevision){state={lastRate:1,rateRevision:0};seed=true;}
  else if(rateValue(data?.lastRate)&&!hasRevision){state={lastRate:data.lastRate,rateRevision:0};seed=true;}
  else if(rateValue(data?.lastRate)&&revisionValue(data?.lastRateRevision))state={lastRate:data.lastRate,rateRevision:data.lastRateRevision};
  else throw Error('無效的播放速度記憶資料');
  if(seed)await this.storage.set(stored(state));
  this.state=state;
  return state;
 }
 load(){return this.enqueue(async()=>copy(await this.ensureLoaded()));}
 read(){return this.enqueue(async()=>copy(await this.ensureLoaded()));}
 observeChanges(changes,area='local'){
  const revisionChange=changes?.lastRateRevision,eventRevision=revisionChange?.newValue;
  const rateChange=changes?.lastRate,hasRateChange=Object.hasOwn(changes||{},'lastRate');
  if(area!=='local'||!revisionChange||!revisionValue(eventRevision)||hasRateChange&&!rateValue(rateChange?.newValue))return Promise.resolve(null);
  return this.enqueue(async()=>{
   const current=await this.ensureLoaded();
   if(eventRevision<=current.rateRevision)return copy(current);
   const data=await this.storage.get(['lastRate','lastRateRevision']);
   if(!rateValue(data?.lastRate)||!revisionValue(data?.lastRateRevision)||data.lastRateRevision<eventRevision)return copy(current);
   const eventRate=hasRateChange?rateChange.newValue:current.lastRate;
   if(data.lastRate!==eventRate)return copy(current);
   this.state={lastRate:data.lastRate,rateRevision:data.lastRateRevision};
   return copy(this.state);
  });
 }
 remember(rate,source,{isCurrent=()=>true}={}){
  if(!rateValue(rate)||!SOURCES.has(source))return Promise.resolve(null);
  const stillCurrent=()=>{try{return isCurrent()===true;}catch{return false;}};
  return this.enqueue(async()=>{
   if(!stillCurrent())return null;
   const currentState=await this.ensureLoaded();
   if(!stillCurrent())return null;
   if(currentState.lastRate===rate)return copy(currentState);
   if(currentState.rateRevision>=Number.MAX_SAFE_INTEGER)throw Error('播放速度記憶版本已達上限');
   const next={lastRate:rate,rateRevision:currentState.rateRevision+1};
   if(!stillCurrent())return null;
   try{await this.storage.set(stored(next));}
   catch(error){this.state=null;throw error;}
   if(!stillCurrent()){this.state=null;return null;}
   this.state=next;
   return copy(next);
  });
 }
}
