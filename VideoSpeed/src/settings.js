import {normalizeSiteRules,validateSiteRules,normalizeSiteModes,validateSiteModes} from './site-rules.js';
const LEGACY_DEFAULT_STEPS=Object.freeze([0.25,0.5,0.75,1,1.25,1.5,2,2.5,3,3.5,4]);
export const DEFAULT_STEPS=Object.freeze([0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.5,3,3.5,4]);
export const DEFAULT_SHORTCUTS=Object.freeze({slower:'<',faster:'>',reset:':',preferred:'"',fineSlower:'',fineFaster:''});
export const DEFAULT_SETTINGS=Object.freeze({schemaVersion:3,enabled:true,preferredRate:2,defaultMode:'off',customRate:2,steps:DEFAULT_STEPS,qualityEnabled:false,preferredQuality:1080,shortcuts:DEFAULT_SHORTCUTS,disabledSites:Object.freeze([]),siteModes:Object.freeze({})});
export function validRate(value){return value!==''&&value!==null&&Number.isFinite(Number(value))&&Number(value)>=0.06&&Number(value)<=16;}
export const formatRate=value=>String(Number(Number(value).toFixed(2)));
export const normalizeRate=value=>Math.max(0.0625,Math.min(16,Math.round((Number(value)+Number.EPSILON)*100)/100));
const SHORTCUT_MODIFIERS=Object.freeze(['Ctrl','Alt','Meta','Shift']);
const MODIFIER_NAMES=Object.freeze({ctrl:'Ctrl',control:'Ctrl',alt:'Alt',meta:'Meta',shift:'Shift'});
function normalizeShortcut(value){
 if(value==='')return '';
 if(typeof value!=='string')return null;
 let key=value,modifiers=[];
 while(true){
  const match=/^(Ctrl|Control|Alt|Meta|Shift)\+/i.exec(key);
  if(!match)break;
  const modifier=MODIFIER_NAMES[match[1].toLowerCase()];
  if(modifiers.includes(modifier))return null;
  modifiers.push(modifier);key=key.slice(match[0].length);
 }
 if(Array.from(key).length!==1||/\s|[\u0000-\u001f\u007f]/u.test(key))return null;
 if(/^[A-Za-z]$/.test(key))key=key.toUpperCase();
 else modifiers=modifiers.filter(modifier=>modifier!=='Shift');
 modifiers.sort((a,b)=>SHORTCUT_MODIFIERS.indexOf(a)-SHORTCUT_MODIFIERS.indexOf(b));
 return [...modifiers,key].join('+');
}
function normalizeShortcuts(raw={}){
 const shortcuts={...DEFAULT_SHORTCUTS};
 for(const action of Object.keys(shortcuts)){
  if(raw?.[action]===undefined)continue;
  const normalized=normalizeShortcut(raw[action]);
  if(normalized!==null)shortcuts[action]=normalized;
 }
 const assigned=Object.values(shortcuts).filter(Boolean);
 return new Set(assigned).size===assigned.length?shortcuts:{...DEFAULT_SHORTCUTS};
}
function hasLegacyDefaultSteps(raw){
 return Number(raw?.schemaVersion??0)<3&&Array.isArray(raw?.steps)&&raw.steps.length===LEGACY_DEFAULT_STEPS.length&&
  raw.steps.every((value,index)=>typeof value==='number'&&value===LEGACY_DEFAULT_STEPS[index]);
}
export function normalizeSteps(value){
 const values=Array.isArray(value)?value:String(value??'').trim().split(/[\s,，、]+/);
 return [...new Set(values.filter(validRate).map(v=>normalizeRate(v)))].sort((a,b)=>a-b).slice(0,64);
}
export function normalizeSettings(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
 const steps=normalizeSteps(raw.steps??DEFAULT_STEPS),oldPreferred=raw.defaultMode==='preferred',shortcuts=normalizeShortcuts(raw.shortcuts),disabledSites=normalizeSiteRules(raw.disabledSites);
 if(hasLegacyDefaultSteps(raw))steps.splice(0,steps.length,...normalizeSteps([...steps,1.75]));
 return {schemaVersion:3,enabled:raw.enabled!==false,preferredRate:validRate(raw.preferredRate)?normalizeRate(raw.preferredRate):2,
  defaultMode:['off','follow','custom'].includes(raw.defaultMode)?raw.defaultMode:oldPreferred?'custom':'off',
  customRate:oldPreferred&&validRate(raw.preferredRate)?normalizeRate(raw.preferredRate):validRate(raw.customRate)?normalizeRate(raw.customRate):2,
  steps:steps.length?steps:[...DEFAULT_STEPS],
  qualityEnabled:raw.qualityEnabled===true,preferredQuality:Number.isInteger(Number(raw.preferredQuality))&&(Number(raw.preferredQuality)===0||Number(raw.preferredQuality)>=100&&Number(raw.preferredQuality)<=8640)?Number(raw.preferredQuality):1080,shortcuts,disabledSites,siteModes:normalizeSiteModes(raw.siteModes,disabledSites)};
}
export function validateSettings(raw){
 if(!validRate(raw.preferredRate)||!validRate(raw.customRate))throw Error('Enter a speed between 0.06 and 16');
 const steps=validateSteps(raw.steps);
 const shortcuts={...DEFAULT_SHORTCUTS};
 for(const action of Object.keys(shortcuts)){
  if(raw.shortcuts?.[action]===undefined)continue;
  const normalized=normalizeShortcut(raw.shortcuts[action]);
  if(normalized===null)throw Error('Use a character key with optional modifiers');
  shortcuts[action]=normalized;
 }
 const keys=Object.values(shortcuts).filter(Boolean);
 if(new Set(keys).size!==keys.length)throw Error('Shortcuts must be unique');
 const disabledSites=validateSiteRules(raw.disabledSites??[]),siteModes=validateSiteModes(raw.siteModes,disabledSites);
 return normalizeSettings({...raw,steps,shortcuts,disabledSites,siteModes});
}
export function validateSteps(raw){
 const values=Array.isArray(raw)?raw:String(raw??'').trim().split(/[\s,，、]+/);
 if(!values.length||values.length>64||values.some(value=>!validRate(value)))throw Error('Use 1–64 ticks between 0.06 and 16');
 return normalizeSteps(values);
}
export const defaultRate=(settings,lastRate=1)=>settings.defaultMode==='off'?null:settings.defaultMode==='custom'?settings.customRate:validRate(lastRate)?Number(lastRate):1;
// Each declared interval has five linear drag positions; values are rounded for display and control.
export function rateAtPosition(position,steps){
 const values=normalizeSteps(steps);if(values.length<2)return values[0]??1;
 const p=Math.round(Math.max(0,Math.min(values.length-1,Number(position)||0))*5)/5;
 if(Number.isInteger(p))return values[p];
 const i=Math.floor(p),value=values[i]+(values[i+1]-values[i])*(p-i);
 return Math.max(values[i],Math.min(values[i+1],normalizeRate(value)));
}
export function positionAtRate(rate,steps){
 const values=normalizeSteps(steps);if(values.length<2||rate<=values[0])return 0;
 if(rate>=values.at(-1))return values.length-1;
 const i=values.findIndex((v,index)=>index<values.length-1&&rate<=values[index+1]);
 return i+(rate-values[i])/(values[i+1]-values[i]);
}
export function stepRate(current,steps,direction){
 const sorted=normalizeSteps(steps);if(!sorted.length)return current;
 return direction>0?(sorted.find(value=>value>Number(current)+1e-6)??Math.max(Number(current),sorted.at(-1))):
  ([...sorted].reverse().find(value=>value<Number(current)-1e-6)??Math.min(Number(current),sorted[0]));
}
export function fineStepRate(current,steps,direction){
 const values=normalizeSteps(steps);if(!values.length)return current;
 const points=[values[0]];
 for(let index=0;index<values.length-1;index++)for(let part=1;part<=5;part++)points.push(rateAtPosition(index+part/5,values));
 return direction>0?(points.find(value=>value>Number(current)+1e-6)??Math.max(Number(current),values.at(-1))):
  (points.reverse().find(value=>value<Number(current)-1e-6)??Math.min(Number(current),values[0]));
}
export function shortcutFromEvent(event){
 if(!event||event.isComposing||event.keyCode===229)return null;
 const key=event.key;
 if(typeof key!=='string'||Array.from(key).length!==1||/\s|[\u0000-\u001f\u007f]/u.test(key))return null;
 if(/^[A-Za-z]$/.test(key)){
  const modifiers=[];
  if(event.ctrlKey)modifiers.push('Ctrl');
  if(event.altKey)modifiers.push('Alt');
  if(event.metaKey)modifiers.push('Meta');
  if(event.shiftKey)modifiers.push('Shift');
  return normalizeShortcut([...modifiers,key.toUpperCase()].join('+'));
 }
 const modifiers=[];
 if(event.ctrlKey)modifiers.push('Ctrl');
 if(event.altKey)modifiers.push('Alt');
 if(event.metaKey)modifiers.push('Meta');
 return normalizeShortcut([...modifiers,key].join('+'));
}
export function shortcutAction(event,shortcuts=DEFAULT_SHORTCUTS){
 const shortcut=shortcutFromEvent(event);
 if(shortcut===null)return null;
 return Object.entries(shortcuts).find(([,key])=>key!==''&&normalizeShortcut(key)===shortcut)?.[0]??null;
}
export function editingEvent(event){return (event.composedPath?.()||[event.target]).some(node=>node?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName||'')||node?.getAttribute?.('role')==='textbox');}
export const TARGET_PREFERENCE_MS=4000;
export function targetIsProminent(item){
 if(!item?.visible)return false;
 const area=Math.max(0,Number(item.visibleArea??item.area??1)),ratio=Number(item.visibleRatio??(item.area?area/item.area:1));
 return area>0&&(ratio>=.25||item.viewportArea>0&&area/item.viewportArea>=.2);
}
function targetScore(item,now){
 if(!item.visible)return 0;
 const area=Math.max(0,Number(item.visibleArea??item.area??1)),ratio=Math.max(0,Math.min(1,Number(item.visibleRatio??(item.area?area/item.area:1)))),center=Math.max(0,Math.min(1,Number(item.centrality??1)));
 const age=now-Number(item.interactedAt||0),recent=Number(item.interactedAt)>0&&age>=0&&age<TARGET_PREFERENCE_MS;
 return Math.sqrt(area)*(.65+.35*ratio)*(.7+.3*center)*(item.playing?1.03:1)*(recent?1.12:1);
}
export function rankTargets(items,preference,{now=Date.now(),currentKey=null}={}){
 const connected=items.filter(item=>item.connected!==false);
 const fullscreen=connected.filter(item=>item.fullscreen),prominent=connected.filter(targetIsProminent),visible=connected.filter(item=>item.visible);
 const pool=fullscreen.length?fullscreen:prominent.length?prominent:visible.length?visible:connected;
 const scored=pool.map(item=>({item,score:targetScore(item,now)})).sort((a,b)=>b.score-a.score||Number(!!b.item.playing)-Number(!!a.item.playing)||(b.item.lastPlayedAt||0)-(a.item.lastPlayedAt||0));
 if(!scored.length)return [];
 const preferredKey=typeof preference==='string'?preference:preference?.until>now?preference.key:null;
 const preferred=scored.find(value=>value.item.key===preferredKey&&targetIsProminent(value.item));
 const current=scored.find(value=>value.item.key===currentKey&&targetIsProminent(value.item));
 const first=preferred||current&&current.score*1.15>=scored[0].score&&current||scored[0];
 return [first.item,...scored.filter(value=>value!==first).map(value=>value.item)];
}
