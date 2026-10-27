import {validRate} from './settings.js';
const revision=value=>Number.isSafeInteger(value)&&value>=0;
export class RateClient{
 constructor(onChange=()=>{}){this.rate=null;this.revision=-1;this.pending=null;this.deferred=null;this.serial=0;this.sessionId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);this.onChange=onChange;this.error='';}
 accept(state){
  if(!validRate(state?.lastRate)||!revision(state?.rateRevision)||state.rateRevision<this.revision)return false;
  if(this.pending){if(!this.deferred||state.rateRevision>this.deferred.rateRevision)this.deferred={lastRate:Number(state.lastRate),rateRevision:state.rateRevision};return false;}
  if(state.rateRevision===this.revision&&this.rate!==null&&Number(state.lastRate)!==this.rate)return false;
  this.rate=Number(state.lastRate);this.revision=state.rateRevision;this.error='';this.onChange(this.rate);return true;
 }
 acceptStorageChanges(changes,area='local'){
  if(area!=='local')return 'ignored';
  const changed=changes||{},hasRate=Object.hasOwn(changed,'lastRate'),hasRevision=Object.hasOwn(changed,'lastRateRevision');
  if(!hasRate&&!hasRevision)return 'ignored';
  if(!hasRate||!hasRevision)return 'refresh';
  const rate=changes.lastRate?.newValue,rateRevision=changes.lastRateRevision?.newValue;
  if(typeof rate!=='number'||!Number.isFinite(rate)||!validRate(rate)||!revision(rateRevision))return 'refresh';
  this.accept({lastRate:rate,rateRevision});
  return 'handled';
 }
 begin(rate){
  if(!validRate(rate))throw Error('Invalid playback speed');
  const token=++this.serial;this.pending={token,rate:Number(rate)};this.rate=Number(rate);this.error='';this.onChange(this.rate);return token;
 }
 acknowledge(token,response){
  const snapshot=response?.ok&&validRate(response.lastRate)&&revision(response.rateRevision);
  const valid=snapshot&&response.accepted===true&&response.rateWriteId===token&&response.rateSessionId===this.sessionId;
  if(this.pending?.token!==token){if(snapshot)this.accept(response);return false;}
  if(!valid){if(snapshot)this.accept(response);this.error=response?.error||'Saved speed could not be confirmed';return false;}
  this.pending=null;const latest=this.deferred?.rateRevision>response.rateRevision?this.deferred:response;this.deferred=null;
  return this.accept(latest);
 }
 snapshot(){return {rate:this.rate,revision:this.revision,pending:!!this.pending,error:this.error};}
}
