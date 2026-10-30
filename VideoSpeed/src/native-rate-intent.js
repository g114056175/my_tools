import {validRate} from './settings.js';

const SPEED_LABEL=/playback[\s_-]*(?:rate|speed)|(?:video|media)[\s_-]*speed|\bspeed\b|播放(?:速度|倍速)|(?:影片|視頻)?倍速|播放速率/iu;
const SPEED_MARKER=/(?:^|[^a-z0-9])(?:speed[-_ ]?(?:slider|control|menu|panel|option|adjust|up|down|plus|minus)|playback[-_ ]?(?:rate|speed)(?:[-_ ]?(?:slider|control|menu|option|item|button|adjust|up|down|plus|minus))?|bpx-player-ctrl-playbackrate-menu-item)(?:$|[^a-z0-9])/iu;
const BILI_RATE_OPTION=/\bbpx-player-ctrl-playbackrate-menu-item\b/iu;
const OPTION_ROLES=new Set(['menuitemradio','menuitem','option','radio']);
const ACTIVATION_KEYS=new Set(['Enter',' ','Space','Spacebar']);
const ARROW_KEYS=new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);

function tagOf(node){return String(node?.tagName||'').toUpperCase();}
function attr(node,name){try{return node?.getAttribute?.(name)||'';}catch{return '';}}
function pathOf(event){
 try{const path=event?.composedPath?.();if(Array.isArray(path)&&path.length)return path;}catch{}
 return event?.target?[event.target]:[];
}
function describedBy(node){
 const ids=attr(node,'aria-labelledby').trim().split(/\s+/u).filter(Boolean).slice(0,4);
 if(!ids.length)return '';
 let document;
 try{document=node.ownerDocument;}catch{}
 return ids.map(id=>{
  try{return document?.getElementById?.(id)?.textContent||'';}catch{return '';}
 }).join(' ');
}
function nodeText(node){
 try{return String(node?.textContent||'').trim().replace(/\s+/gu,' ');}catch{return '';}
}
function nodeMarkerText(node){
 let className='';
 try{className=typeof node?.className==='string'?node.className:'';}catch{}
 return [attr(node,'id'),attr(node,'class'),className].filter(Boolean).join(' ');
}
function hasSpeedMarker(node){return SPEED_MARKER.test(nodeMarkerText(node));}
function labelText(node){
 return [attr(node,'aria-label'),attr(node,'title'),attr(node,'name'),attr(node,'data-testid'),describedBy(node)].filter(Boolean).join(' ');
}
function explicitSpeedNode(node){
 return SPEED_LABEL.test(labelText(node))||SPEED_MARKER.test([labelText(node),nodeMarkerText(node)].join(' '));
}
function hasSpeedContext(path){return path.slice(0,10).some(node=>node&&explicitSpeedNode(node));}
function inRoleMenu(node,path){
 try{if(node.closest?.('[role="menu"],[role="listbox"],[role="radiogroup"]'))return true;}catch{}
 return path.some(item=>['menu','listbox','radiogroup'].includes(String(attr(item,'role')).toLowerCase())&&item!==node);
}
function valueOf(text,{plain=false,normal=false}={}){
 const value=String(text||'').trim().replace(/\s+/gu,' ');
 if(normal&&/^(?:(?:playback[\s_-]*(?:rate|speed)|(?:video|media)[\s_-]*speed|speed|播放速度|播放倍速|倍速|播放速率)\s*[:：]?\s*)?(?:normal(?:\s+speed)?|standard|正常(?:速度)?|標準(?:速度)?|原速)(?:\s*[/·(（]?\s*1(?:\.0+)?\s*(?:x|×|倍(?:速)?)\s*[)）]?)?$/iu.test(value))return 1;
 const match=value.match(/^(?:(?:playback[\s_-]*(?:rate|speed)|(?:video|media)[\s_-]*speed|speed|播放速度|播放倍速|倍速|播放速率)\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(x|×|倍(?:速)?)?$/iu);
 if(!match||!plain&&!match[2]||!validRate(Number(match[1])))return null;
 return Number(match[1]);
}
function firstRate(candidates,{plain=false,normal=false}={}){
 for(const candidate of candidates){
  if(typeof candidate!=='string'||candidate.length>96)continue;
  const rate=valueOf(candidate,{plain,normal});
  if(rate!==null)return rate;
 }
 return null;
}
function optionLike(node,path){
 const role=String(attr(node,'role')).toLowerCase(),tag=tagOf(node);
 if(OPTION_ROLES.has(role)||tag==='OPTION'||BILI_RATE_OPTION.test(nodeMarkerText(node)))return true;
 return (tag==='BUTTON'||role==='button')&&inRoleMenu(node,path);
}
function sliderLike(node){
 const tag=tagOf(node),role=String(attr(node,'role')).toLowerCase(),type=String(attr(node,'type')||node?.type||'').toLowerCase();
 const sliderMarker=/(?:speed[-_ ]?slider|playback[-_ ]?(?:rate|speed)[-_ ]?slider)/iu.test(nodeMarkerText(node));
 return role==='slider'||tag==='INPUT'&&(!type||['range','number'].includes(type))||sliderMarker&&tag!=='BUTTON';
}
function sliderValue(node){
 const candidates=[];
 if(['INPUT','SELECT'].includes(tagOf(node)))try{candidates.push(String(node.value??''));}catch{}
 candidates.push(attr(node,'aria-valuetext'),attr(node,'aria-valuenow'));
 return firstRate(candidates,{plain:true,normal:true});
}
function unrelatedSlider(node){return /volume|seek|progress|timeline|brightness|contrast|音量|播放進度|亮度|對比/iu.test(labelText(node)+' '+nodeMarkerText(node));}
function activationKey(event){return event.type==='click'||event.type==='keydown'&&ACTIVATION_KEYS.has(event.key);}
function adjustmentIntent(node,path){
 const tag=tagOf(node),role=String(attr(node,'role')).toLowerCase();
 if(tag!=='BUTTON'&&role!=='button')return null;
 const marker=nodeMarkerText(node)+' '+labelText(node);
 const text=(labelText(node)+' '+nodeText(node)).trim();
 const explicit=hasSpeedContext(path)||SPEED_LABEL.test(marker)||SPEED_MARKER.test(marker);
 if(!explicit)return null;
 const plus=/\b(?:increase|faster|speed\s*up|speed\s*plus|plus)\b|(?:加快|增加|提高|更快|加速|倍速加)/iu.test(text)||/\b(?:speed|playbackrate)[-_]?(?:up|plus)\b/iu.test(marker);
 const minus=/\b(?:decrease|slower|speed\s*down|speed\s*minus|minus)\b|(?:減慢|減少|降低|更慢|減速|倍速減)/iu.test(text)||/\b(?:speed|playbackrate)[-_]?(?:down|minus)\b/iu.test(marker);
 const symbol=/^[+＋]$/u.test(nodeText(node))||/^[+＋]$/u.test(attr(node,'aria-label'));
 const minusSymbol=/^[-−－]$/u.test(nodeText(node))||/^[-−－]$/u.test(attr(node,'aria-label'));
 return plus||symbol?{rate:null}:minus||minusSymbol?{rate:null}:null;
}
function intentForSlider(event,node,path){
 if(!sliderLike(node)||!hasSpeedContext(path))return null;
 if(event.type==='pointermove'&&!(Number(event.buttons)>0))return null;
 if(['pointerdown','pointerup'].includes(event.type)&&event.button!==0)return null;
 if(event.type==='keydown'&&ARROW_KEYS.has(event.key))return {rate:null};
 if(['click','pointerdown','pointermove','pointerup'].includes(event.type))return {rate:null};
 if(!['input','change'].includes(event.type))return null;
 const rate=sliderValue(node);
 return rate===null?null:{rate};
}

/**
 * Returns trusted, explicit native playback-rate intent. A null rate denotes
 * a rate adjustment action whose exact resulting value is not exposed by DOM.
 */
export function nativeRateIntentFromEvent(event){
 if(!event?.isTrusted)return null;
 const path=pathOf(event);
 if(!path.length)return null;
 const type=String(event.type||'');
 const speedContext=hasSpeedContext(path);

 if(['input','change'].includes(type)){
  for(const node of path.slice(0,8)){
   if(!node?.getAttribute||['BODY','HTML'].includes(tagOf(node)))break;
   if(sliderLike(node)&&unrelatedSlider(node))return null;
   if(['INPUT','SELECT'].includes(tagOf(node))&&hasSpeedContext(path)){
    const rate=sliderValue(node);
    if(rate!==null)return {rate};
   }
  }
 }

 // Pointer callbacks may still expose the previous value. They authorize a
 // write during that input event, never a guessed rate from stale ARIA text.
 if(['input','change','click','pointerdown','pointermove','pointerup','keydown'].includes(type)){
  for(const node of path.slice(0,8)){
   if(!node?.getAttribute||['BODY','HTML'].includes(tagOf(node)))break;
   if(sliderLike(node)&&unrelatedSlider(node))return null;
   if(type==='keydown'&&ARROW_KEYS.has(event.key)){
    const slider=intentForSlider(event,node,path);
    if(slider)return slider;
    continue;
   }
   if(['input','change','click','pointerdown','pointermove','pointerup'].includes(type)){
    const slider=intentForSlider(event,node,path);
    if(slider)return slider;
   }
  }
 }

 // Menu choices are confirmed by click or keyboard activation, never by
 // pointerdown/up. Bare numbers and "Normal" require speed-specific context.
 if(type==='pointerup'){
  for(const node of path.slice(0,8)){
   if(!node?.getAttribute||['BODY','HTML'].includes(tagOf(node)))break;
   const intent=adjustmentIntent(node,path);
   if(intent)return intent;
  }
  return null;
 }
 if(!activationKey(event))return null;
 for(const node of path.slice(0,8)){
  if(!node?.getAttribute||['BODY','HTML'].includes(tagOf(node)))break;
  const popup=attr(node,'aria-haspopup');if(popup&&popup!=='false')continue;
  const marker=nodeMarkerText(node),ownSpeedContext=explicitSpeedNode(node),semantic=optionLike(node,path);
  const nonsemanticSpeed=ownSpeedContext||speedContext;
  if(!semantic&&!nonsemanticSpeed)continue;
  const allowPlain=ownSpeedContext||speedContext||semantic;
  const allowNormal=allowPlain;
  const candidates=[
   labelText(node),
   attr(node,'data-value'),
   nodeText(node),
  ];
  const rate=firstRate(candidates,{plain:allowPlain,normal:allowNormal});
  if(rate!==null)return {rate};
  const adjusted=adjustmentIntent(node,path);
  if(adjusted)return adjusted;
  // A semantic option carrying an explicit rate unit is sufficiently clear
  // even when the site's menu omits its own speed label.
  if(semantic){
   const explicitRate=firstRate(candidates,{plain:false,normal:false});
   if(explicitRate!==null)return {rate:explicitRate};
  }
 }

 return null;
}

// Compatibility API: exact expected rate, or null when absent/inexact.
export function nativeRateFromEvent(event){
 return nativeRateIntentFromEvent(event)?.rate??null;
}
