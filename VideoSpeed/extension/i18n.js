import {ZH_MESSAGES,legacyChineseMessageToEnglish} from './locale-zh.js';

const UNKNOWN_ERROR='An unexpected error occurred';
const containsCjk=value=>/[\u3400-\u9fff]/u.test(value);
const interpolate=(text,values={})=>text.replace(/\{(\w+)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));

export function resolveLanguage(value){return value==='zh-Hant'?'zh-Hant':'en';}

export function translate(language,key,values={}){
 let text=String(key??'');
 const legacy=legacyChineseMessageToEnglish(text);
 if(legacy)text=legacy;
 if(language!=='zh-Hant'&&containsCjk(text))text=UNKNOWN_ERROR;
 if(language==='zh-Hant')text=ZH_MESSAGES[text]??text;
 return interpolate(text,values);
}

export function translateMessage(language,message){
 let text=String(message??'');
 const legacy=legacyChineseMessageToEnglish(text);
 if(legacy)text=legacy;
 if(language!=='zh-Hant'&&containsCjk(text))return UNKNOWN_ERROR;
 const saving=text.match(/^Could not save: (.*)$/s);
 if(saving)return translate(language,'Could not save: {message}',{message:translateMessage(language,saving[1])});
 const best=text.match(/^Best \((\d+)p\)$/);if(best)return translate(language,'Best ({height}p)',{height:best[1]});
 const automatic=text.match(/^(\d+)p \(Auto\)$/);if(automatic)return translate(language,'{height}p (Auto)',{height:automatic[1]});
 const quality=text.match(/^Preferred (\d+)p; this video uses (\d+)p$/);if(quality)return translate(language,'Preferred {wanted}p; this video uses {effective}p',{wanted:quality[1],effective:quality[2]});
 return translate(language,text);
}

export function applyPopupLanguage(root,language){
 const textBindings={
  '#single-target':'Loading…','#advanced>summary>span':'Playback options','#tab-preferences':'Prefs','#tab-interface':'Interface','#tab-steps':'Ticks','#tab-shortcuts':'Keys','#tab-sites':'Exclude',
  '.settings-header h1':'Settings','#appearance-label':'Appearance','#language-label':'Language','[data-language=zh-Hant]':'Chinese',
  '[data-theme=light]>span':'Light','[data-theme=dark]>span':'Dark','.field-label':'Default','[data-mode=off]':'Off','[data-mode=follow]':'Last','[data-mode=custom]':'Fixed',
  '#custom-row':'Fixed','#quality-label':'Quality','#quality-value':'Off','.preferred-setting':'Preferred',
  '#step-reset-request':'Reset defaults','#shortcut-reset-request':'Reset defaults','#step-reset-cancel':'Cancel','#shortcut-reset-cancel':'Cancel',
  '#step-reset-confirm':'Reset','#shortcut-reset-confirm':'Reset','#step-reset-toolbar>span':'Reset ticks?','#shortcut-reset-toolbar>span':'Reset shortcuts?',
 };
 for(const [selector,key]of Object.entries(textBindings)){
  const node=root.querySelector(selector);if(!node)continue;
  if(selector==='#custom-row'||selector==='.preferred-setting'){
   const text=[...node.childNodes].find(item=>item.nodeType===3);if(text)text.nodeValue=translate(language,key);
  }else node.textContent=translate(language,key);
 }
 const attrs=[
  ['#enabled','title','Loading'],['#enabled','aria-label','Loading'],['#pick','title','Select a video on the page'],['#pick','aria-label','Select a video on the page'],
  ['#refresh','title','Refresh video'],['#refresh','aria-label','Refresh video'],['#open-settings','title','Settings'],['#open-settings','aria-label','Settings'],
  ['#settings-back','title','Back'],['#settings-back','aria-label','Back'],['[data-tab-group=playback]','aria-label','Playback options'],['.playback','aria-label','Playback speed'],
  ['#current-rate','aria-label','Current playback speed'],['#rate-slider','aria-label','Playback speed slider'],['[data-tab-group=configuration]','aria-label','Settings tabs'],
  ['.field-label','title','Playback speed when a video first starts'],['.mode-switch','aria-label','Default'],['[data-mode=follow]','title','Use the last speed from the previous video'],
  ['[data-mode=custom]','title','Start each video at the fixed speed'],['#custom-row','title','Start each video at the fixed speed'],
  ['.preferred-setting','title','Use the preferred-speed shortcut to switch to this speed'],['#quality-list','aria-label','Quality'],['#steps-input','aria-label','Speed ticks'],
  ['#site-input','placeholder','Domain or video URL'],['#site-input','aria-label','Add a blocked domain or video URL'],['#site-add','aria-label','Add block rule'],
 ];
 for(const [selector,attribute,key]of attrs)root.querySelector(selector)?.setAttribute(attribute,translate(language,key));
 root.documentElement.lang=resolveLanguage(language);
}
