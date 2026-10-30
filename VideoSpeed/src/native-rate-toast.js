import {validRate} from './settings.js';

const MARKER='data-video-control-native-rate-hidden',DISCOVERY_MS=2000,LIMIT=24;
const CONFIG={
 youtube:{containers:'.ytp-bezel-text-wrapper,.ytp-bezel',candidates:'.ytp-bezel-text,.ytp-bezel[aria-label]',players:'#movie_player,.html5-video-player'},
 bilibili:{containers:'.bpx-player-toast-wrap,.bpx-player-three-playrate-hint,.bpx-player-tooltip-area',candidates:'.bpx-player-toast-text,.bpx-player-three-playrate-hint,.bpx-player-tooltip-item[data-name="shortcut"]',players:'.bpx-player-container,.bilibili-player,#bilibili-player'},
};

export function nativeToastPlatform(hostname){
 const host=String(hostname||'').toLowerCase().replace(/\.$/u,'');
 if(/(^|\.)youtube(?:-nocookie)?\.com$/u.test(host))return 'youtube';
 if(/(^|\.)bilibili\.com$/u.test(host))return 'bilibili';
 return null;
}

export function parseNativeSpeed(text,{allowBare=false}={}){
 const value=String(text??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
 if(value.length>80)return null;
 const match=/^(?:(playback\s*(?:speed|rate)|speed|播放速度|播放倍速|倍速|速度)(?:\s*(?:is|為|为|是))?\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(?:(x|×|倍(?:速)?)(?:\s*(?:播放(?:中)?|playing))?)?$/iu.exec(value);
 if(!match||!validRate(Number(match[2]))||!allowBare&&!match[1]&&!match[3])return null;
 return {rate:Number(match[2]),precision:Math.min(4,match[2].split('.')[1]?.length||0)};
}

// Discovery is brief and restricted to the selected known player. Once a
// message is hidden, its small native container remains observed until reuse
// or removal so a later warning on the same node is restored immediately.
export class NativeRateToast{
 constructor(document,{isActive=()=>true}={}){
  this.document=document;this.view=document.defaultView;this.isActive=isActive;
  this.config=CONFIG[nativeToastPlatform(this.view?.location?.hostname)];
  this.containers=new Set();this.hidden=new Map();this.video=null;this.root=null;this.key=null;this.until=0;
 }
 arm(video,rate,key){
  if(!this.config||!video?.isConnected||!validRate(rate)||!this.isActive(video))return false;
  const root=video.closest(this.config.players);if(!root||!root.contains(video))return false;
  const continuing=this.root===root&&this.video===video&&this.key===key;
  if(!continuing)this.stop();
  this.root=root;this.video=video;this.key=key;this.rate=Number(rate);this.until=Date.now()+DISCOVERY_MS;
  if(!this.watch)this.watch=new this.view.MutationObserver(records=>this.changed(records));
  this.ensureStyle();
  let removed=false;for(const container of [...this.containers])if(!container.isConnected||!root.contains(container)){this.containers.delete(container);removed=true;}
  if(removed){this.watch.disconnect();for(const container of this.containers)this.observe(container);}
  if(!continuing||!this.discovery)this.discover(root);else for(const container of this.containers)this.scan(container);
  this.sweep();
  if(!this.discovery){
   this.discovery=new this.view.MutationObserver(records=>{
    if(!this.active()){this.stop();return;}
    let budget=LIMIT;
    for(const record of records)for(const node of record.addedNodes){if(--budget<0)return;if(node.nodeType===1)this.discover(node);}
   });
   this.discovery.observe(root,{childList:true,subtree:true});
  }
  clearTimeout(this.timer);this.timer=setTimeout(()=>{
   this.discovery?.disconnect();this.discovery=null;this.sweep();
   if(!this.hidden.size)this.stop();
  },DISCOVERY_MS);
  return true;
 }
 active(){
  return !!this.video?.isConnected&&!!this.root?.isConnected&&this.root.contains(this.video)&&this.isActive(this.video);
 }
 ensureStyle(){
  if(this.style?.isConnected)return;
  const style=this.document.createElement('style');style.textContent=`[${MARKER}]{display:none!important}`;
  const tree=this.root.getRootNode();(tree.nodeType===11?tree:this.document.head||this.document.documentElement).append(style);this.style=style;
 }
 discover(node){
  if(!this.root.contains(node)&&node!==this.root)return;
  const found=[];
  if(node.matches?.(this.config.containers))found.push(node);
  for(const candidate of node.querySelectorAll?.(this.config.containers)||[]){found.push(candidate);if(found.length>=LIMIT)break;}
  for(let container of found){
   if(this.config===CONFIG.youtube&&container.parentElement!==this.root)container=container.parentElement;
   if(!container)continue;
   if(!this.containers.has(container)){if(this.containers.size>=8)continue;this.containers.add(container);this.observe(container);}
   this.scan(container);
  }
 }
 observe(container){this.watch.observe(container,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['aria-label','data-name']});}
 scan(node){
  if(node.matches?.(this.config.candidates))this.update(node);
  let count=0;for(const candidate of node.querySelectorAll?.(this.config.candidates)||[]){this.update(candidate);if(++count>=LIMIT)break;}
 }
 changed(records){
  if(!this.active()){this.stop();return;}
  const candidates=new Set();let budget=LIMIT*2;
  for(const record of records){
   if(--budget<0)break;
   const node=record.target.nodeType===1?record.target:record.target.parentElement;
   const candidate=node?.closest?.(this.config.candidates);if(candidate)candidates.add(candidate);
   for(const added of record.addedNodes||[]){
    if(--budget<0)break;
    if(added.nodeType!==1)continue;
    if(added.matches(this.config.candidates))candidates.add(added);
    for(const item of added.querySelectorAll(this.config.candidates)){candidates.add(item);if(candidates.size>=LIMIT)break;}
   }
  }
  this.sweep();let count=0;for(const candidate of candidates){this.update(candidate);if(++count>=LIMIT)break;}
  if(Date.now()>this.until&&!this.hidden.size)this.stop();
 }
 inspect(candidate){
  if(!this.root?.contains(candidate))return null;
  const hint=candidate.matches('.bpx-player-three-playrate-hint');
  const shortcut=candidate.matches('.bpx-player-tooltip-item[data-name="shortcut"]');
  const label=shortcut?candidate.querySelector('.bpx-player-tooltip-title'):hint?candidate.querySelector('[class$="-three-playrate-hint-label"]')||candidate:candidate;
  if(!label)return null;
  const text=candidate.matches('.ytp-bezel')?candidate.getAttribute('aria-label'):label.textContent;
  const parsed=parseNativeSpeed(text,{allowBare:hint});if(!parsed)return null;
  let actual;try{actual=Number(this.video.playbackRate);}catch{return null;}
  const matches=parsed.precision===0?Math.abs(actual-parsed.rate)<1e-5:Number(actual.toFixed(parsed.precision))===parsed.rate;
  // This dedicated shortcut OSD can retain the previous multiplier after a
  // newer VS command. It remains speed-only feedback and must stay hidden.
  if(!validRate(actual)||Math.abs(actual-this.rate)>1e-5||!shortcut&&!matches)return null;
  const target=candidate.matches('.bpx-player-toast-text')?candidate.closest('.bpx-player-toast-item')||candidate:candidate;
  if(!this.root.contains(target))return null;
  // A native toast's dismiss control only closes that same message. It is
  // safe to hide with a speed-only toast; confirmation/link actions are not.
  for(const control of target.querySelectorAll('button,a,input,[role="button"],.bpx-player-toast-confirm,.bpx-player-toast-confirm-login'))if(!control.closest('.bpx-player-toast-cancel'))return null;
  if(candidate.matches('.bpx-player-toast-text')&&target.querySelectorAll('.bpx-player-toast-text').length>1)return null;
  return target;
 }
 update(candidate){
  if(!this.active()){this.stop();return;}
  const target=this.inspect(candidate);
  if(target&&(Date.now()<=this.until||this.hidden.has(target))){
   if(!this.hidden.has(target)&&this.hidden.size<LIMIT){
    this.hidden.set(target,{candidate,previous:target.getAttribute(MARKER)});target.setAttribute(MARKER,'');
   }
  }
 }
 sweep(){
  if(!this.active()){this.stop();return;}
  for(const [target,record]of this.hidden)if(!target.isConnected||!record.candidate.isConnected||this.inspect(record.candidate)!==target)this.restore(target);
 }
 restore(target){
  const record=this.hidden.get(target);if(!record)return;
  if(record.previous===null)target.removeAttribute(MARKER);else target.setAttribute(MARKER,record.previous);
  this.hidden.delete(target);
 }
 stop(video){
  if(video&&video!==this.video)return;
  clearTimeout(this.timer);this.timer=null;this.discovery?.disconnect();this.watch?.disconnect();this.discovery=null;this.watch=null;
  for(const target of [...this.hidden.keys()])this.restore(target);
  this.style?.remove();this.style=null;this.containers.clear();this.video=null;this.root=null;this.key=null;this.until=0;
 }
}
