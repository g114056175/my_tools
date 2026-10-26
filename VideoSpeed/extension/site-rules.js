function webUrl(value){try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url:null;}catch{return null;}}
const hostOf=url=>url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
export function normalizeSiteRule(value){
 const raw=String(value??'').trim();if(!raw||raw.length>2048)throw Error('請輸入網域或完整網址');
 if(!raw.includes('://')&&!/[/?#*\s]/.test(raw)){
  const url=webUrl('https://'+raw);if(!url||url.username||url.password||url.port||raw.includes(':')&&!/^\[[a-f0-9:]+\]$/i.test(raw))throw Error('網域格式不正確');
  const host=hostOf(url);if(!host)throw Error('網域格式不正確');return host;
 }
 const url=webUrl(raw);if(!url||url.username||url.password)throw Error('請輸入 http 或 https 網址');
 if(url.hostname.includes('*')||url.pathname.includes('*')&&(!url.pathname.endsWith('/*')||url.pathname.slice(0,-1).includes('*'))||url.search.includes('*'))throw Error('僅支援網址路徑結尾的 /*');
 url.hostname=hostOf(url);url.searchParams.sort();return url.href;
}
export function normalizeSiteRules(raw){
 if(!Array.isArray(raw))return [];
 const rules=[];for(const item of raw.slice(0,200)){try{const rule=normalizeSiteRule(item);if(!rules.includes(rule))rules.push(rule);}catch{}}return rules;
}
export function validateSiteRules(raw){
 if(!Array.isArray(raw)||raw.length>200)throw Error('最多可設定 200 條停用規則');return [...new Set(raw.map(normalizeSiteRule))];
}
export function normalizeSiteModes(raw,rules){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
 const modes={};
 for(const [value,mode]of Object.entries(raw).slice(0,200)){
  try{const rule=normalizeSiteRule(value);if(mode==='default'&&rules.includes(rule))Object.defineProperty(modes,rule,{value:mode,enumerable:true,configurable:true,writable:true});}catch{}
 }
 return modes;
}
export function validateSiteModes(raw,rules){
 if(raw===undefined)return {};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>200)throw Error('無效的除外類型');
 for(const [value,mode]of Object.entries(raw))if(!['full','default'].includes(mode)||!rules.includes(normalizeSiteRule(value)))throw Error('無效的除外類型');
 return normalizeSiteModes(raw,rules);
}
function matchesSiteRule(url,raw){
 const host=hostOf(url);
  if(!raw.includes('://'))return host===raw||host.endsWith('.'+raw);
  const rule=webUrl(raw);if(!rule||hostOf(rule)!==host||rule.port!==url.port||rule.hash&&rule.hash!==url.hash)return false;
  const prefix=rule.pathname.endsWith('/*');if(prefix?!url.pathname.startsWith(rule.pathname.slice(0,-1)):rule.pathname!==url.pathname)return false;
  const youtubeVideo=/(^|\.)youtube\.com$/.test(host)&&rule.pathname==='/watch'&&rule.searchParams.has('v');
  if(!prefix&&!youtubeVideo){const actual=new URL(url);actual.searchParams.sort();return actual.search===rule.search&&actual.hash===rule.hash;}
  for(const key of new Set(rule.searchParams.keys())){const expected=rule.searchParams.getAll(key),actual=url.searchParams.getAll(key);if(expected.length!==actual.length||expected.some((value,index)=>value!==actual[index]))return false;}
  return true;
}
export function siteModeOnUrl(value,rules=[],modes={}){
 const url=webUrl(value);if(!url)return null;
 let result=null;
 for(const rule of rules){
  if(!matchesSiteRule(url,rule))continue;
  if(modes[rule]!=='default')return 'full';
  result='default';
 }
 return result;
}
export function disabledOnUrl(value,rules=[],modes={}){return siteModeOnUrl(value,rules,modes)==='full';}
export function settingsForUrls(settings,...urls){
 const modes=urls.map(url=>siteModeOnUrl(url,settings.disabledSites,settings.siteModes));
 const skip=modes.some(Boolean);
 return {...settings,enabled:settings.enabled&&!modes.includes('full'),defaultMode:skip?'off':settings.defaultMode,qualityEnabled:!skip&&settings.qualityEnabled};
}
