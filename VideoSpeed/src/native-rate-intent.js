import {validRate} from './settings.js';

const speedLabel=/playback\s*(?:rate|speed)|(?:video|media)\s*speed|播放(?:速度|倍速)|(?:影片|視頻)?倍速|播放速率/iu;
function valueOf(text,{plain=false,normal=false}={}){
 const value=String(text||'').trim().replace(/\s+/gu,' ');
 if(normal&&/^(?:normal(?: speed)?|standard|正常(?:速度)?|標準(?:速度)?|原速)(?:\s*[/·(（]?\s*1(?:\.0+)?\s*(?:x|×|倍(?:速)?)\s*[)）]?)?$/iu.test(value))return 1;
 const match=value.match(/^(?:(?:playback\s*(?:rate|speed)|speed|播放速度|播放倍速|倍速|播放速率)\s*[:：]?\s*)?(\d+(?:\.\d+)?)\s*(x|×|倍(?:速)?)?$/iu);
 if(!match||!plain&&!match[2]||!validRate(Number(match[1])))return null;
 return Number(match[1]);
}

// ratechange itself carries no evidence of who changed the rate.
// Match a trusted choice and its expected value, rather than any player click.
export function nativeRateFromEvent(event){
 if(!event?.isTrusted||!['click','input','change','keydown'].includes(event.type))return null;
 if(event.type==='keydown'&&!['Enter',' ','Spacebar'].includes(event.key))return null;
 const path=event.composedPath?.()||[event.target];
 for(const node of path.slice(0,8)){
  if(!node?.getAttribute||['BODY','HTML'].includes(node.tagName))break;
  const role=node.getAttribute('role')||'',tag=node.tagName;
  const popup=node.getAttribute('aria-haspopup');if(popup&&popup!=='false')continue;
  const label=node.getAttribute('aria-label')||node.getAttribute('title')||'';
  if(['INPUT','SELECT'].includes(tag)&&['input','change'].includes(event.type)){
   const description=[label,node.getAttribute('name'),node.getAttribute('data-testid')].filter(Boolean).join(' ');
   if(speedLabel.test(description))return valueOf(node.value,{plain:true});
  }
  if(!['click','keydown'].includes(event.type))continue;
  const option=['menuitemradio','menuitem','option','radio'].includes(role)||tag==='OPTION';
  const inMenu=node.closest?.('[role="menu"],[role="listbox"],[role="radiogroup"]');
  if(!option&&(!(tag==='BUTTON'||role==='button')||!inMenu))continue;
  const text=(node.textContent||'').trim();
  for(const candidate of [label,text]){
   if(candidate.length>64)continue;
   const rate=valueOf(candidate,{plain:option||!!inMenu,normal:option||!!inMenu});
   if(rate!==null)return rate;
  }
 }
 return null;
}
