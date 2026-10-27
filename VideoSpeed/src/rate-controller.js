import {defaultRate,stepRate,fineStepRate,validRate,normalizeRate} from './settings.js';
export const MAX_AUTOMATIC_WRITES=4;
export const MAX_INITIALIZATION_ATTEMPTS=3;
const same=(a,b)=>validRate(a)&&validRate(b)&&Math.abs(Number(a)-Number(b))<1e-5;
function readVideo(video){
 try{const actualRate=Number(video.playbackRate),value=Number(video.defaultPlaybackRate);return validRate(actualRate)?{status:'ready',actualRate,defaultRate:validRate(value)?value:null}:{status:'read-error',actualRate:null,defaultRate:null,error:'invalid-rate'};}
 catch(error){return {status:'read-error',actualRate:null,defaultRate:null,error:String(error?.message||error)};}
}
export class RateController{
 constructor(video,settings,{signature=()=>video.currentSrc||video.src||'',canInitialize=()=>true,onChange=()=>{},onMedia=()=>{},onRate=()=>{},onInitialize=()=>{},onDefaultApplied=()=>{},readRate,writeRate,releaseRate,initializedKey='',lastRate=1,selected=false}={}){
  Object.assign(this,{video,settings,signature,canInitialize,onChange,onMedia,onRate,onInitialize,onDefaultApplied,initializedKey,lastRate,selected,
   readRate:readRate||(()=>readVideo(video)),writeRate,releaseRate,mediaKey:null,initialized:false,disposed:false,actualRate:null,defaultPlaybackRate:null,desired:null,managedRate:null,
   rateStatus:'unknown',rateOrigin:'unknown',error:'',revision:0,automaticWrites:0,initializationAttempts:0,initializationBlocked:false,initializationTimer:null,repairTimer:null,mediaResetPending:false,awaitingMedia:false,localDefault:null,adoptionPending:false,events:[]});
  this.handlers={};
  for(const name of ['loadedmetadata','loadeddata','loadstart','play','playing','pause','ended','ratechange','emptied']){const handler=()=>this.event(name);this.handlers[name]=handler;video.addEventListener(name,handler);}
  this.sync();
 }
 note(kind,extra={}){this.events.push({kind,at:Date.now(),rate:this.actualRate,desired:this.desired,...extra});if(this.events.length>32)this.events.shift();}
 read(){
  let result;try{result=this.readRate();}catch(error){result={status:'read-error',error:String(error?.message||error)};}
  this.actualRate=validRate(result?.actualRate)?Number(result.actualRate):null;this.defaultPlaybackRate=validRate(result?.defaultRate)?Number(result.defaultRate):null;
  if(result?.status!=='ready'||this.actualRate===null){this.rateStatus='failed';this.rateOrigin='read-error';this.error='Playback speed unavailable';return {...result,status:'read-error',actualRate:this.actualRate};}
  if(this.desired===null)this.desired=this.actualRate;
  if(this.rateOrigin==='read-error'){this.rateStatus='ready';this.rateOrigin='page';this.error='';}
  return result;
 }
 cancelRepair(){clearTimeout(this.repairTimer);this.repairTimer=null;}
 cancelInitialization(){clearTimeout(this.initializationTimer);this.initializationTimer=null;}
 retryInitialization(){
  if(this.initializationTimer!==null||this.initializationAttempts>=MAX_INITIALIZATION_ATTEMPTS)return;
  const key=this.mediaKey,revision=this.revision;
  this.initializationTimer=setTimeout(()=>{
   this.initializationTimer=null;
   if(!this.disposed&&this.revision===revision&&this.mediaKey===key&&!this.initialized&&this.selected)this.sync(false,'initialization-retry');
  },this.initializationAttempts===1?100:400);
 }
 release(){
  this.cancelRepair();this.cancelInitialization();
  try{if(this.releaseRate)this.releaseRate();else if(this.localDefault&&same(this.video.defaultPlaybackRate,this.localDefault.owned))this.video.defaultPlaybackRate=this.localDefault.baseline;}catch{}
  this.localDefault=null;this.managedRate=null;this.mediaResetPending=false;
 }
 sync(mediaEvent=false,eventName='',initialize=true){
  if(this.disposed)return;
  let key;try{key=this.signature();}catch{this.read();return;}
  if(this.mediaKey===null||(key&&key!==this.mediaKey)){
   const first=this.mediaKey===null,initialIntent=this.mediaKey===''&&this.initialized?this.managedRate:null;
   this.release();this.revision++;this.mediaKey=key;this.initialized=!!key&&this.initializedKey===key;this.automaticWrites=0;this.initializationAttempts=0;this.initializationBlocked=false;
   this.adoptionPending=this.initialized;
   if(initialIntent!==null){this.initialized=true;this.adoptionPending=false;this.managedRate=initialIntent;this.desired=initialIntent;this.mediaResetPending=true;}
   this.awaitingMedia=!first&&!mediaEvent&&!(eventName==='playing'&&this.video.readyState>=2);
   this.error='';this.rateStatus='unknown';this.onMedia();
  }
  this.read();if(mediaEvent||eventName==='playing')this.awaitingMedia=false;
  if(initialize)this.initialize();
 }
 select(selected){this.selected=selected;if(selected)this.sync();else {this.read();this.cancelRepair();this.cancelInitialization();}}
 update(settings,lastRate=this.lastRate){
  const stoppedDefaults=settings.defaultMode==='off'&&this.settings.defaultMode!=='off';this.settings=settings;
  if(validRate(lastRate))this.lastRate=Number(lastRate);if(!settings.enabled)this.cancelInitialization();if(stoppedDefaults){this.release();this.revision++;}this.sync();
 }
 initialize(){
  if(this.disposed||!this.settings.enabled||!this.selected||this.awaitingMedia||this.video.paused||this.video.ended||this.video.readyState===0||!this.mediaKey||!this.canInitialize())return;
  if(this.initialized){
   if(this.adoptionPending){this.adoptionPending=false;if(this.settings.defaultMode!=='off'&&validRate(this.actualRate))this.apply(this.actualRate,'preserved',{adopt:true});}
   if(this.mediaResetPending&&this.managedRate!==null&&this.video.readyState>=1)this.queueRepair('load');return;
  }
  if(this.settings.defaultMode==='follow'&&!validRate(this.lastRate)){this.rateStatus='failed';this.rateOrigin='memory-error';this.error='Saved speed unavailable';this.onChange();return;}
  const rate=defaultRate(this.settings,this.lastRate);
  if(rate===null){
   if(this.actualRate===null){this.onMedia();return;}
   this.initialized=true;this.onInitialize(this.mediaKey);this.rateStatus='ready';this.rateOrigin='page';this.error='';this.onMedia();return;
  }
  if(this.initializationBlocked||this.initializationAttempts>=MAX_INITIALIZATION_ATTEMPTS)return;
  this.cancelInitialization();
  this.initializationAttempts++;
  if(this.apply(rate,'default')){this.initialized=true;this.initializationAttempts=0;this.onInitialize(this.mediaKey);this.persist(rate,'default');this.onDefaultApplied(rate);}
  else if(['unavailable','read-error'].includes(this.rateOrigin))this.retryInitialization();
  else this.initializationBlocked=true;
  this.onMedia();
 }
 writeDirect(rate,{op='apply',maintainDefault=true}={}){
  const before=readVideo(this.video);if(before.status!=='ready')return before;
  try{
   this.video.preservesPitch=true;
   if(op!=='adopt'&&!same(before.actualRate,rate))this.video.playbackRate=rate;
   const verified=readVideo(this.video);if(verified.status!=='ready'||!same(verified.actualRate,rate))return {...verified,status:verified.status==='ready'?'mismatch':verified.status};
   if(maintainDefault){
    if(!this.localDefault&&validRate(before.defaultRate))this.localDefault={baseline:before.defaultRate,owned:rate};
    if(this.localDefault)this.localDefault.owned=rate;if(!same(before.defaultRate,rate))this.video.defaultPlaybackRate=rate;
   }
   const after=readVideo(this.video);return after.status==='ready'&&same(after.actualRate,rate)?after:{...after,status:after.status==='ready'?'mismatch':after.status};
  }catch(error){return {...readVideo(this.video),status:'write-error',error:String(error?.message||error)};}
 }
 apply(rate,source,{adopt=false}={}){
  if(this.disposed||!this.settings.enabled||!validRate(rate))return false;
  const options={op:adopt?'adopt':'apply',rate:Number(rate),reason:source,maintainDefault:this.settings.defaultMode!=='off'};
  let result;try{result=this.writeRate?this.writeRate(Number(rate),options):this.writeDirect(Number(rate),options);}catch(error){result={status:'write-error',error:String(error?.message||error)};}
  this.actualRate=validRate(result?.actualRate)?Number(result.actualRate):null;this.defaultPlaybackRate=validRate(result?.defaultRate)?Number(result.defaultRate):null;
  if(result?.status!=='ready'||!same(this.actualRate,rate)){
   this.cancelRepair();this.managedRate=null;this.desired=Number(rate);
   this.rateStatus='failed';this.rateOrigin=result?.status||'unavailable';this.error=result?.status==='unsupported'?'Live streams do not support playback speed':result?.status==='write-error'?'Player does not accept this speed':this.actualRate===null?'Playback speed unavailable':'Player did not apply this speed';
   this.note('write-failed',{status:result?.status,error:result?.error});this.onChange();return false;
  }
  this.desired=Number(rate);this.managedRate=Number(rate);this.rateStatus='ready';this.rateOrigin=source;this.error='';this.note('applied',{source});this.onChange();return true;
 }
 persist(rate,source){if(source==='default'&&this.settings.defaultMode==='follow')return;if(this.selected&&validRate(rate)){this.lastRate=Number(rate);this.onRate(Number(rate),source);}}
 observe(info){
  if(this.disposed||!this.settings.enabled||!info)return;this.sync(false,'observation',false);
  if(info.mediaKey&&info.mediaKey!==this.mediaKey)return;
  if(info.status==='read-error'||!validRate(info.actualRate)){this.actualRate=null;this.rateStatus='failed';this.rateOrigin='read-error';this.error='Playback speed unavailable';this.note('read-failed');this.onChange();return;}
  this.actualRate=Number(info.actualRate);this.defaultPlaybackRate=validRate(info.defaultRate)?Number(info.defaultRate):null;
  const origin=info.origin||'unknown';this.note('observed',{origin,evidence:info.evidence,property:info.property});
  if(origin==='vc'){this.onChange();return;}
  if(origin==='ambiguous'&&info.evidence==='rate-option-default-pending'){this.onChange();return;}
  if(origin==='user'&&this.selected&&this.canInitialize()){
   if(validRate(info.attemptedRate)&&!same(info.attemptedRate,this.actualRate)){this.onChange();return;}
   this.cancelRepair();this.cancelInitialization();this.revision++;this.mediaResetPending=false;this.initialized=true;this.automaticWrites=0;this.initializationAttempts=0;this.initializationBlocked=false;const rate=this.actualRate;
   if(this.settings.defaultMode==='off'&&this.managedRate===null){this.desired=rate;this.rateStatus='ready';this.rateOrigin='native';this.error='';this.persist(rate,'native');}
   else if(this.apply(rate,'native',{adopt:true})){this.onInitialize(this.mediaKey);this.persist(rate,'native');}this.onChange();return;
  }
  if(origin==='load'||origin==='transition'||origin==='ambiguous'&&['loading','starting'].includes(info.phase)){
   this.mediaResetPending=true;if(this.initialized&&this.managedRate!==null&&this.video.readyState>0&&!this.video.paused)this.queueRepair('load');
  }else if(origin==='page'){
   if(this.managedRate!==null&&(!same(this.actualRate,this.managedRate)||this.settings.defaultMode!=='off'&&!same(this.defaultPlaybackRate,this.managedRate)))this.queueRepair('page');
  }else if((origin==='unknown'||origin==='ambiguous')&&this.managedRate!==null&&!same(this.actualRate,this.managedRate)){
   // Preserve an unclassified local change without promoting it to global memory.
   if(this.settings.defaultMode!=='off'){
    const options={op:'adopt',rate:this.actualRate,reason:'unclassified-local',maintainDefault:true};
    try{if(this.writeRate)this.writeRate(this.actualRate,options);else this.writeDirect(this.actualRate,options);}catch{}
   }
   this.cancelRepair();this.revision++;this.managedRate=null;this.desired=this.actualRate;this.rateOrigin=origin;this.rateStatus='unknown';this.error='';
  }this.onChange();
 }
 queueRepair(reason){
  if(this.disposed||this.managedRate===null||!this.settings.enabled)return;
  this.mediaResetPending=true;
  if(this.repairTimer!==null||!this.selected||this.video.paused||this.video.ended)return;
  if(this.automaticWrites>=MAX_AUTOMATIC_WRITES){this.rateStatus='conflict';this.rateOrigin=reason;this.error='The site keeps overriding playback speed';this.note('recovery-limit');this.onChange();return;}
  const key=this.mediaKey,revision=this.revision;
  this.repairTimer=setTimeout(()=>{
   this.repairTimer=null;
   let currentKey;try{currentKey=this.signature();}catch{this.rateStatus='failed';this.error='Video state unavailable';this.onChange();return;}
   if(this.disposed||revision!==this.revision||currentKey!==key||this.managedRate===null||!this.selected||!this.settings.enabled||this.video.paused||this.video.ended||this.video.readyState===0||!this.canInitialize())return;
   const result=this.read();if(result.status!=='ready')return;
   if(same(this.actualRate,this.managedRate)&&(this.settings.defaultMode==='off'||same(this.defaultPlaybackRate,this.managedRate))){this.mediaResetPending=false;return;}
   this.automaticWrites++;if(this.apply(this.managedRate,'recovery'))this.mediaResetPending=false;else this.managedRate=null;
  },0);
 }
 event(name){
  if(this.disposed)return;
  if(name==='loadstart'||name==='emptied'){this.cancelRepair();this.revision++;this.mediaResetPending=true;}
  this.sync(name==='loadedmetadata',name);if(name==='ratechange')this.onChange();
 }
 command(action,value){
  this.sync(false,'command',false);this.cancelRepair();this.cancelInitialization();this.revision++;this.automaticWrites=0;const current=this.actualRate;
  if(['faster','slower','fineFaster','fineSlower'].includes(action)&&!validRate(current))throw Error('Playback speed unavailable');
  const next=action==='reset'?1:action==='preferred'?this.settings.preferredRate:action==='faster'?stepRate(current,this.settings.steps,1):action==='slower'?stepRate(current,this.settings.steps,-1):action==='fineFaster'?fineStepRate(current,this.settings.steps,1):action==='fineSlower'?fineStepRate(current,this.settings.steps,-1):Number(value);
  if(!validRate(next))throw Error('Invalid playback speed');this.mediaResetPending=false;
  if(this.apply(normalizeRate(next),'command')){this.initialized=true;this.initializationAttempts=0;this.initializationBlocked=false;this.onInitialize(this.mediaKey);this.persist(this.desired,'command');}return this.snapshot();
 }
 snapshot(){return {rate:this.actualRate,desiredRate:this.desired,rateStatus:this.rateStatus,rateOrigin:this.rateOrigin,rateError:this.error};}
 diagnostics(){return {...this.snapshot(),key:this.mediaKey,managedRate:this.managedRate,automaticWrites:this.automaticWrites,events:[...this.events]};}
 dispose(){if(this.disposed)return;this.disposed=true;this.release();for(const [name,handler]of Object.entries(this.handlers))this.video.removeEventListener(name,handler);}
}
