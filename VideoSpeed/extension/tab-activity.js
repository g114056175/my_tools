export const TAB_ACTIVITY_GRACE_MS=10_000;

const validId=value=>Number.isInteger(value)&&value>=0;

export function replayTabActivityEvents(activity,events,{windowIdNone=-1}={}){
 const affected=new Set();
 for(const event of events){
  if(!event||!Number.isFinite(event.at))continue;
  let changed=[];
  if(event.type==='activated')changed=activity.setActiveTab(event.windowId,event.tabId,event.at);
  else if(event.type==='created')changed=activity.openFrom(event.openerTabId,event.tabId,event.at);
  else if(event.type==='focus')changed=activity.setFocusedWindow(event.windowId===windowIdNone?null:event.windowId,event.at);
  for(const tabId of changed)affected.add(tabId);
 }
 return [...affected];
}

export class TabActivity{
 constructor({now=()=>Date.now(),graceMs=TAB_ACTIVITY_GRACE_MS}={}){
  this.now=now;this.graceMs=graceMs;this.focusedWindowId=null;this.focusedTabId=null;this.revision=0;this.untilByTab=new Map();this.activeByWindow=new Map();
 }
 restore(snapshot){
  this.focusedWindowId=validId(snapshot?.focusedWindowId)?snapshot.focusedWindowId:null;
  this.focusedTabId=this.focusedWindowId!==null&&validId(snapshot?.focusedTabId)?snapshot.focusedTabId:null;
  this.revision=Number.isSafeInteger(snapshot?.revision)&&snapshot.revision>=0?snapshot.revision:0;
  this.untilByTab=new Map();
  const entries=Object.entries(snapshot?.untilByTab||{});
  for(const [key,value]of entries){const tabId=Number(key);if(validId(tabId)&&Number.isFinite(value)&&value>0)this.untilByTab.set(tabId,value);}
  this.activeByWindow=new Map();
  const activeEntries=Object.entries(snapshot?.activeByWindow||{});
  for(const [key,value]of activeEntries){const windowId=Number(key),tabId=Number(value);if(validId(windowId)&&validId(tabId))this.activeByWindow.set(windowId,tabId);}
  if(this.focusedWindowId!==null&&this.focusedTabId!==null)this.activeByWindow.set(this.focusedWindowId,this.focusedTabId);
  if(this.focusedTabId!==null)this.untilByTab.delete(this.focusedTabId);
  return this;
 }
 snapshot(now=this.now()){
  this.prune(now);
  return {version:1,focusedWindowId:this.focusedWindowId,focusedTabId:this.focusedTabId,revision:this.revision,untilByTab:Object.fromEntries(this.untilByTab),activeByWindow:Object.fromEntries(this.activeByWindow)};
 }
 activity(tabId,now=this.now()){
  if(!validId(tabId))return {focused:false,until:0,revision:this.revision};
  const focused=this.focusedTabId===tabId;
  const until=focused?0:this.untilByTab.get(tabId)||0;
  return {focused,until:until>now?until:0,revision:this.revision};
 }
 setFocusedWindow(windowId,now=this.now()){
  const nextWindowId=validId(windowId)?windowId:null;
  if(nextWindowId===this.focusedWindowId){
   const cachedTabId=nextWindowId===null?null:this.activeByWindow.get(nextWindowId);
   return this.focusedTabId===null&&validId(cachedTabId)?this.setActiveTab(nextWindowId,cachedTabId,now):[];
  }
  const affected=[];
  this.blurFocusedTab(now,affected);
  this.focusedWindowId=nextWindowId;this.focusedTabId=null;this.revision++;
  const cachedTabId=nextWindowId===null?null:this.activeByWindow.get(nextWindowId);
  if(validId(cachedTabId))for(const tabId of this.setActiveTab(nextWindowId,cachedTabId,now))affected.push(tabId);
  return affected;
 }
 setActiveTab(windowId,tabId,now=this.now()){
  if(!validId(windowId)||!validId(tabId))return [];
  this.rememberActiveTab(windowId,tabId);
  if(windowId!==this.focusedWindowId)return [];
  if(this.focusedTabId===tabId)return [];
  const affected=[];
  this.blurFocusedTab(now,affected);
  this.focusedTabId=tabId;this.untilByTab.delete(tabId);this.revision++;affected.push(tabId);
  return affected;
 }
 rememberActiveTab(windowId,tabId){
  if(!validId(windowId)||!validId(tabId)||this.activeByWindow.get(windowId)===tabId)return false;
  this.activeByWindow.set(windowId,tabId);return true;
 }
 openFrom(openerTabId,tabId,now=this.now()){
  if(!validId(openerTabId)||!validId(tabId)||tabId===openerTabId||tabId===this.focusedTabId)return [];
  const opener=this.activity(openerTabId,now);if(!opener.focused&&opener.until<=now)return [];
  const until=now+this.graceMs;if((this.untilByTab.get(tabId)||0)>=until)return [];
  this.untilByTab.set(tabId,until);this.revision++;return [tabId];
 }
 restoreRecent(tabId,until,now=this.now()){
  if(!validId(tabId)||tabId===this.focusedTabId||!Number.isSafeInteger(until)||until<=now||until>now+this.graceMs||(this.untilByTab.get(tabId)||0)>=until)return false;
  this.untilByTab.set(tabId,until);this.revision++;return true;
 }
 reconcile({windowId=null,tabId=null}={},now=this.now()){
  const affected=new Set();
  if(validId(windowId)&&validId(tabId))this.rememberActiveTab(windowId,tabId);
  for(const changedTabId of this.setFocusedWindow(windowId,now))affected.add(changedTabId);
  if(validId(windowId)&&validId(tabId))for(const changedTabId of this.setActiveTab(windowId,tabId,now))affected.add(changedTabId);
  else if(this.focusedTabId!==null){for(const changedTabId of this.setFocusedWindow(null,now))affected.add(changedTabId);}
  return [...affected];
 }
 forget(tabId){
  if(!validId(tabId))return false;
  let had=this.untilByTab.delete(tabId);
  for(const [windowId,cachedTabId]of this.activeByWindow)if(cachedTabId===tabId){this.activeByWindow.delete(windowId);had=true;}
  if(this.focusedTabId===tabId){this.focusedTabId=null;this.revision++;return true;}
  return had;
 }
 forgetWindow(windowId,now=this.now()){
  if(!validId(windowId))return [];
  this.activeByWindow.delete(windowId);
  return this.focusedWindowId===windowId?this.setFocusedWindow(null,now):[];
 }
 prune(now=this.now()){
  for(const [tabId,until]of this.untilByTab)if(until<=now||tabId===this.focusedTabId)this.untilByTab.delete(tabId);
  for(const [windowId,tabId]of this.activeByWindow)if(!validId(windowId)||!validId(tabId))this.activeByWindow.delete(windowId);
  if(this.focusedWindowId!==null&&this.focusedTabId!==null)this.activeByWindow.set(this.focusedWindowId,this.focusedTabId);
 }
 blurFocusedTab(now,affected){
  const tabId=this.focusedTabId;
  if(tabId===null)return;
  this.focusedTabId=null;this.untilByTab.set(tabId,now+this.graceMs);affected.push(tabId);
 }
}
