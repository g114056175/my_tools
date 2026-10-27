export const TAB_ACTIVITY_GRACE_MS=10_000;

const validId=value=>Number.isInteger(value)&&value>=0;

export function replayTabActivityEvents(activity,events,{windowIdNone=-1}={}){
 const affected=new Set();
 for(const event of events){
  if(!event||!Number.isFinite(event.at))continue;
  let changed=[];
  if(event.type==='activated')changed=activity.setActiveTab(event.windowId,event.tabId,event.at);
  else if(event.type==='focus')changed=activity.setFocusedWindow(event.windowId===windowIdNone?null:event.windowId,event.at);
  for(const tabId of changed)affected.add(tabId);
 }
 return [...affected];
}

export class TabActivity{
 constructor({now=()=>Date.now(),graceMs=TAB_ACTIVITY_GRACE_MS}={}){
  this.now=now;this.graceMs=graceMs;this.focusedWindowId=null;this.focusedTabId=null;this.revision=0;this.untilByTab=new Map();
 }
 restore(snapshot){
  this.focusedWindowId=validId(snapshot?.focusedWindowId)?snapshot.focusedWindowId:null;
  this.focusedTabId=this.focusedWindowId!==null&&validId(snapshot?.focusedTabId)?snapshot.focusedTabId:null;
  this.revision=Number.isSafeInteger(snapshot?.revision)&&snapshot.revision>=0?snapshot.revision:0;
  this.untilByTab=new Map();
  const entries=Object.entries(snapshot?.untilByTab||{});
  for(const [key,value]of entries){const tabId=Number(key);if(validId(tabId)&&Number.isFinite(value)&&value>0)this.untilByTab.set(tabId,value);}
  if(this.focusedTabId!==null)this.untilByTab.delete(this.focusedTabId);
  return this;
 }
 snapshot(now=this.now()){
  this.prune(now);
  return {version:1,focusedWindowId:this.focusedWindowId,focusedTabId:this.focusedTabId,revision:this.revision,untilByTab:Object.fromEntries(this.untilByTab)};
 }
 activity(tabId,now=this.now()){
  if(!validId(tabId))return {focused:false,until:0,revision:this.revision};
  const focused=this.focusedTabId===tabId;
  const until=focused?0:this.untilByTab.get(tabId)||0;
  return {focused,until:until>now?until:0,revision:this.revision};
 }
 setFocusedWindow(windowId,now=this.now()){
  const nextWindowId=validId(windowId)?windowId:null;
  if(nextWindowId===this.focusedWindowId)return [];
  const affected=[];
  this.blurFocusedTab(now,affected);
  this.focusedWindowId=nextWindowId;this.focusedTabId=null;this.revision++;
  return affected;
 }
 setActiveTab(windowId,tabId,now=this.now()){
  if(!validId(tabId)||windowId!==this.focusedWindowId)return [];
  if(this.focusedTabId===tabId)return [];
  const affected=[];
  this.blurFocusedTab(now,affected);
  this.focusedTabId=tabId;this.untilByTab.delete(tabId);this.revision++;affected.push(tabId);
  return affected;
 }
 reconcile({windowId=null,tabId=null}={},now=this.now()){
  const affected=new Set();
  for(const changedTabId of this.setFocusedWindow(windowId,now))affected.add(changedTabId);
  if(validId(windowId)&&validId(tabId))for(const changedTabId of this.setActiveTab(windowId,tabId,now))affected.add(changedTabId);
  else if(this.focusedTabId!==null){for(const changedTabId of this.setFocusedWindow(null,now))affected.add(changedTabId);}
  return [...affected];
 }
 forget(tabId){
  if(!validId(tabId))return false;
  const had=this.untilByTab.delete(tabId);
  if(this.focusedTabId===tabId){this.focusedTabId=null;this.revision++;return true;}
  return had;
 }
 prune(now=this.now()){
  for(const [tabId,until]of this.untilByTab)if(until<=now||tabId===this.focusedTabId)this.untilByTab.delete(tabId);
 }
 blurFocusedTab(now,affected){
  const tabId=this.focusedTabId;
  if(tabId===null)return;
  this.focusedTabId=null;this.untilByTab.set(tabId,now+this.graceMs);affected.push(tabId);
 }
}
