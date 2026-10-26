import {DEFAULT_STEPS,DEFAULT_SHORTCUTS,normalizeSettings,validRate,normalizeRate,formatRate,validateSteps,shortcutFromEvent,rateAtPosition,positionAtRate} from './settings.js';
import {videoQualityOptions,PRESERVED_QUALITY,QUALITY_OFF} from './quality-options.js';
import {disabledOnUrl,normalizeSiteRule} from './site-rules.js';
import {siteDomain} from './site-domain.js';
import {resolveLanguage,translate,translateMessage,applyPopupLanguage} from './i18n.js';
const $=id=>document.getElementById(id),drafts=new Map();
let state,tabId,revision=0,refreshRevision=0,rateRevision=0,enterCommit=false,rateDirty=false,dragging=false,rateTarget='',sliderKey='',pendingRate=null,sendingRate=false,rateTimer,refreshTimer,closed=false;
let powerBusy=false,stepInputDirty=false,stepInputRevision=0,stepTimer,shortcutRecording='',siteInputDirty=false,siteInputPage='';
const shortcutActions=[['slower','上一刻度'],['faster','下一刻度'],['fineSlower','細調減速'],['fineFaster','細調加速'],['reset','還原 1×'],['preferred','偏好速度']];
let language=resolveLanguage(null,chrome.i18n.getUILanguage());const t=(key,values)=>translate(language,key,values);
const systemTheme=matchMedia('(prefers-color-scheme: dark)');let appearance='system';
function paintTheme(){const dark=appearance==='dark'||appearance==='system'&&systemTheme.matches;document.documentElement.dataset.theme=dark?'dark':'light';for(const button of document.querySelectorAll('button[data-theme]')){const active=button.dataset.theme===(dark?'dark':'light');button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}}
function paintLanguage(){applyPopupLanguage(document,language);for(const button of document.querySelectorAll('[data-language]')){const active=button.dataset.language===language;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}for(const node of document.querySelectorAll('[role=alert]'))if(node.dataset.message)node.textContent=translateMessage(language,node.dataset.message);sliderKey='';if(state)render();}
try{const storedUi=await chrome.storage.local.get(['popupTheme','popupLanguage']);if(['light','dark'].includes(storedUi.popupTheme))appearance=storedUi.popupTheme;language=resolveLanguage(storedUi.popupLanguage,chrome.i18n.getUILanguage());}catch{}
paintLanguage();paintTheme();systemTheme.addEventListener('change',paintTheme);
for(const button of document.querySelectorAll('button[data-theme],button[data-language]'))button.addEventListener('click',async()=>{
 if(!state||!effective().enabled)return;cancelRecording();
 try{await chrome.storage.local.set(button.dataset.theme?{popupTheme:button.dataset.theme}:{popupLanguage:button.dataset.language});}catch{error('feedback',button.dataset.theme?'外觀保存失敗':'保存失敗：無法連線');}
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.popupTheme){appearance=['light','dark'].includes(changes.popupTheme.newValue)?changes.popupTheme.newValue:'system';paintTheme();}if(changes.popupLanguage){language=resolveLanguage(changes.popupLanguage.newValue,chrome.i18n.getUILanguage());paintLanguage();}});
const send=async message=>{const result=await chrome.runtime.sendMessage({scope:'video-control',...(tabId?{tabId}:{}),...message});if(!result?.ok)throw Error(result?.error||'無法連線');return result;};
function error(id,text=''){$(id).dataset.message=text;$(id).textContent=translateMessage(language,text);$(id).hidden=!text;}
function effective(){return {...state.settings,...Object.fromEntries([...drafts].map(([key,item])=>[key,item.value]))};}
function closeQuality(){ $('quality-list').hidden=true;$('quality').setAttribute('aria-expanded','false'); }
function positionQuality(){
 const list=$('quality-list'),anchor=$('quality').getBoundingClientRect(),margin=8,gap=4;
 const bottom=Math.min(window.innerHeight,document.body.getBoundingClientRect().bottom)-margin;
 const above=Math.max(0,anchor.top-margin-gap),below=Math.max(0,bottom-anchor.bottom-gap),up=below<180&&above>below;
 list.style.width=anchor.width+'px';list.style.left=Math.max(margin,Math.min(anchor.left,document.documentElement.clientWidth-anchor.width-margin))+'px';
 list.style.maxHeight=Math.min(340,Math.floor(up?above:below))+'px';
 list.style.top=(up?anchor.top-gap-list.getBoundingClientRect().height:anchor.bottom+gap)+'px';
}
function focusQuality(option){
 if(!option)return;
 const list=$('quality-list');option.focus({preventScroll:true});
 if(option.offsetTop<list.scrollTop)list.scrollTop=option.offsetTop;
 else if(option.offsetTop+option.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=option.offsetTop+option.offsetHeight-list.clientHeight;
}
function openQuality(){
 if(!state||!effective().enabled)return;
 $('quality-list').hidden=false;$('quality').setAttribute('aria-expanded','true');
 positionQuality();focusQuality($('quality-list').querySelector('[aria-selected="true"]'));
}
function qualityOptions(settings){
 const menu=videoQualityOptions(settings.preferredQuality,state.target?.quality?.availableHeights||[],settings.qualityEnabled),signature=JSON.stringify([language,menu.options]);
 if($('quality-list').dataset.options!==signature){
  $('quality-list').replaceChildren(...menu.options.map(item=>{
   const option=document.createElement('button');option.type='button';option.className='quality-option';option.dataset.quality=item.value;option.setAttribute('role','option');option.tabIndex=-1;
   const check=document.createElement('span');check.className='check';check.textContent='✓';check.setAttribute('aria-hidden','true');
   const label=document.createElement('span');label.textContent=translateMessage(language,item.label);option.append(check,label);if(item.title)option.title=translateMessage(language,item.title);
   option.addEventListener('click',async()=>{closeQuality();$('quality').focus();await saveFields(item.value===QUALITY_OFF?{qualityEnabled:false}:item.value===PRESERVED_QUALITY?{qualityEnabled:true}:{qualityEnabled:true,preferredQuality:Number(item.value)});});return option;
  }));$('quality-list').dataset.options=signature;
 }
 for(const option of $('quality-list').children)option.setAttribute('aria-selected',String(option.dataset.quality===menu.selected));
 $('quality').dataset.value=menu.selected;$('quality').classList.toggle('has-quality',settings.qualityEnabled);
 $('quality-value').textContent=translateMessage(language,menu.options.find(item=>item.value===menu.selected)?.label||'關閉');
 if(!$('quality-list').hidden)positionQuality();
}
function fitStepsInput(){const input=$('steps-input');if(!input.offsetWidth)return;input.style.height='0px';input.style.height=Math.max(42,Math.min(180,input.scrollHeight+2))+'px';}
function renderSteps(settings){
 if(!stepInputDirty&&document.activeElement!==$('steps-input'))$('steps-input').value=settings.steps.map(formatRate).join(', ');
 fitStepsInput();
 for(const control of document.querySelectorAll('#advanced button,#advanced input,#settings-view button,#settings-view textarea'))control.disabled=!settings.enabled;
}
function renderShortcuts(settings){
 if(!$('shortcut-list').children.length){
  for(const [action,label]of shortcutActions){
   const row=document.createElement('div');row.className='shortcut-row';
   const text=document.createElement('span');text.dataset.shortcutLabel=action;text.textContent=t(label);if(action==='preferred')text.title=t('按下偏好快捷鍵，跳至偏好速度');
   const button=document.createElement('button');button.type='button';button.className='shortcut-key';button.dataset.shortcut=action;button.setAttribute('aria-label','設定'+label+'快捷鍵');
   button.addEventListener('click',()=>{shortcutRecording=shortcutRecording===action?'':action;error('shortcut-error');renderShortcuts(effective());button.focus();});
   const clear=document.createElement('button');clear.type='button';clear.className='shortcut-clear';clear.dataset.shortcutClear=action;clear.textContent='×';clear.setAttribute('aria-label','清除'+label+'快捷鍵');
   clear.addEventListener('click',()=>saveShortcut(action,''));row.append(text,button,clear);$('shortcut-list').append(row);
  }
 }
 for(const [action,label]of shortcutActions){
  const key=settings.shortcuts[action]||'',button=document.querySelector('[data-shortcut="'+action+'"]'),recording=shortcutRecording===action;
  const text=document.querySelector('[data-shortcut-label="'+action+'"]');text.textContent=t(label);if(action==='preferred')text.title=t('按下偏好快捷鍵，跳至偏好速度');button.setAttribute('aria-label',t('設定{action}快捷鍵',{action:t(label)}));
  button.textContent=recording?t('請按按鍵'):key||t('未設定');button.title=key;button.classList.toggle('is-recording',recording);button.classList.toggle('is-empty',!key&&!recording);button.disabled=!settings.enabled;
  const clear=document.querySelector('[data-shortcut-clear="'+action+'"]');clear.disabled=!settings.enabled||!key;clear.setAttribute('aria-label',t('清除{action}快捷鍵',{action:t(label)}));
 }
}
function unavailable(reason=''){
 if(state)state.target=null;
 $('controls').hidden=false;$('playback').hidden=true;document.body.classList.add('empty');
 $('single-target').textContent=t('未取得影片資訊');$('single-target').title=translateMessage(language,reason);
 pendingRate=null;rateTarget='';rateDirty=false;shortcutRecording='';
 if(state)render();$('single-target').title=translateMessage(language,reason);
}
function renderSites(settings){
 const domain=siteDomain(state.pageUrl),rules=settings.disabledSites,modes=settings.siteModes,signature=JSON.stringify([language,rules,modes]);
 if(siteInputPage!==state.pageUrl){siteInputPage=state.pageUrl;if(!siteInputDirty)$('site-input').value=domain&&!rules.includes(domain)?domain:'';}
 if($('site-list').dataset.rules!==signature){
  $('site-list').dataset.rules=signature;$('site-list').replaceChildren(...rules.map(rule=>{
   const row=document.createElement('div');row.className='site-rule';const label=document.createElement('span');label.textContent=rule;
   const mode=document.createElement('button');mode.type='button';mode.className='site-mode';mode.dataset.rule=rule;
   mode.dataset.mode=modes[rule]==='default'?'default':'full';mode.textContent=mode.dataset.mode==='default'?'Default':'Full';
   mode.title=mode.dataset.mode==='default'?'Skip automatic speed and quality settings':'Disable all features on this site';
   mode.setAttribute('aria-label',rule+': '+mode.textContent+'. '+mode.title);
   mode.addEventListener('click',()=>{const next={...effective().siteModes};if(next[rule]==='default')delete next[rule];else Object.defineProperty(next,rule,{value:'default',enumerable:true,configurable:true,writable:true});saveField('siteModes',next);});
   const remove=document.createElement('button');remove.type='button';remove.className='site-remove';remove.textContent='×';remove.setAttribute('aria-label',t('移除 {rule}',{rule}));remove.addEventListener('click',()=>{const next={...effective().siteModes};delete next[rule];saveFields({disabledSites:effective().disabledSites.filter(item=>item!==rule),siteModes:next});});row.append(label,mode,remove);return row;
  }));
 }
 for(const button of $('site-list').querySelectorAll('button'))button.disabled=!settings.enabled;
}
async function addSiteRule(raw){
 if(!state||!effective().enabled)return;
 try{const rule=normalizeSiteRule(raw);error('site-error');if(effective().disabledSites.includes(rule)||await saveField('disabledSites',[...effective().disabledSites,rule])){$('site-input').value='';siteInputDirty=false;}}catch(problem){error('site-error',problem.message);}
}
function renderSlider(){
 if(!state)return;
 if($('playback').hidden||$('home-view').hidden){sliderKey='';$('rate-slider').disabled=true;return;}
 const settings=effective(),steps=settings.steps,slider=$('rate-slider'),key=JSON.stringify(steps),enabled=settings.enabled&&!disabledOnUrl(state.pageUrl,settings.disabledSites,settings.siteModes)&&!!state.target;
 if(key!==sliderKey){
  sliderKey=key;slider.max=String(Math.max(0,steps.length-1));
  const list=$('slider-ticks'),width=list.getBoundingClientRect().width,rows=[],nodes=[],measure=document.createElement('canvas').getContext('2d');measure.font='12px "Segoe UI"';
  for(const [index,value]of steps.entries()){
   const position=steps.length===1?50:index/(steps.length-1)*100,x=position/100*width,label=formatRate(value),hitWidth=Math.max(24,measure.measureText(label).width+6);
   let row=rows.findIndex(right=>x-hitWidth/2>=right+3);if(row<0){row=rows.length;rows.push(-Infinity);}rows[row]=x+hitWidth/2;
   const line=document.createElement('span');line.className='tick-line';line.style.left=position+'%';line.setAttribute('aria-hidden','true');
   const button=document.createElement('button');button.type='button';button.className='tick';button.dataset.rate=String(value);button.textContent=label;button.setAttribute('aria-label',t('套用 {rate} 倍速',{rate:label}));
   button.style.left=position+'%';button.style.top=String(5+row*22)+'px';button.style.minWidth=hitWidth+'px';button.addEventListener('click',()=>queueRate(value));nodes.push(line,button);
  }
  list.style.height=String(Math.max(1,rows.length)*22+5)+'px';list.replaceChildren(...nodes);
 }
 const known=validRate(state.target?.rate),rate=validRate($('current-rate').value)?Number($('current-rate').value):known?state.target.rate:effective().steps[0];
 if(!dragging)slider.value=String(positionAtRate(rate,steps));
 slider.style.setProperty('--progress',(steps.length>1?Number(slider.value)/(steps.length-1)*100:0)+'%');
 slider.disabled=!enabled||!known||steps.length<2;slider.setAttribute('aria-valuetext',known?t('{rate} 倍速',{rate:formatRate(rate)}):t('無法讀取播放速度'));
 for(const tick of $('slider-ticks').querySelectorAll('.tick')){tick.disabled=!enabled;tick.classList.toggle('active',known&&Math.abs(Number(tick.dataset.rate)-rate)<.001);}
}
function render(){
 if(!state)return;
 const settings=effective(),blocked=disabledOnUrl(state.pageUrl,settings.disabledSites,settings.siteModes),target=blocked?null:state.target;
 document.body.classList.toggle('is-off',!settings.enabled);
 $('enabled').classList.toggle('active',settings.enabled);$('enabled').setAttribute('aria-pressed',String(settings.enabled));$('enabled').disabled=powerBusy;
 $('enabled').title=t(settings.enabled?'關閉 VideoSpeed':'啟用 VideoSpeed');$('enabled').setAttribute('aria-label',$('enabled').title);
 $('pick').disabled=!settings.enabled||blocked;$('refresh').disabled=!settings.enabled||blocked;$('controls').inert=!settings.enabled;
 $('open-settings').disabled=!settings.enabled;$('settings-view').inert=!settings.enabled;
 if(!settings.enabled||blocked){pendingRate=null;clearTimeout(rateTimer);dragging=false;rateDirty=false;shortcutRecording='';closeQuality();}
 if(!settings.enabled){$('advanced').open=false;$('home-view').hidden=false;$('settings-view').hidden=true;}
 $('controls').hidden=false;$('playback').hidden=!settings.enabled||!target;document.body.classList.toggle('empty',!target);
 $('single-target').textContent=target?.title||t(!settings.enabled?'已關閉':blocked?'此網站已停用':'未取得影片資訊');$('single-target').title=target?.title||'';
 $('settings-fields').disabled=!settings.enabled;
 for(const button of document.querySelectorAll('[data-mode]')){button.classList.toggle('active',button.dataset.mode===settings.defaultMode);button.setAttribute('aria-pressed',String(button.dataset.mode===settings.defaultMode));}
 $('custom-row').hidden=settings.defaultMode!=='custom';
 for(const [id,key]of [['preferred-rate','preferredRate'],['custom-rate','customRate']])if(document.activeElement!==$(id))$(id).value=formatRate(settings[key]);
 qualityOptions(settings);
 const key=target?.key||'';
 if(rateTarget!==key){rateTarget=key;rateRevision++;pendingRate=null;rateDirty=false;error('rate-error');}
 if(!rateDirty&&!dragging&&!sendingRate&&pendingRate===null)$('current-rate').value=validRate(target?.rate)?formatRate(target.rate):'';
 if(!rateDirty&&target?.rateError&&['failed','conflict'].includes(target.rateStatus)){error('rate-error',target.rateError);$('rate-error').dataset.runtimeError='true';}
 else if($('rate-error').dataset.runtimeError){error('rate-error');delete $('rate-error').dataset.runtimeError;}
 $('current-rate').disabled=!target||!settings.enabled;
 for(const button of document.querySelectorAll('[data-command]'))button.disabled=!target||!settings.enabled;
 for(const [id,action,label]of [['previous-step','slower','上一個刻度'],['next-step','faster','下一個刻度'],['slower','fineSlower','降低一小格'],['faster','fineFaster','提高一小格']]){$(id).title=t(label)+(settings.shortcuts[action]?' ('+settings.shortcuts[action]+')':'');$(id).setAttribute('aria-label',t(label));}
 renderSteps(settings);renderShortcuts(settings);renderSites(settings);renderSlider();
}
async function saveFields(patch){
 if(!state)return false;
 const changes=Object.entries(patch).filter(([key,value])=>JSON.stringify(effective()[key])!==JSON.stringify(value));if(!changes.length)return true;
 const items=changes.map(([key,value])=>{const item={value,revision:++revision};drafts.set(key,item);return [key,item];});render();error('feedback');
 try{
  const result=await send({action:'updateSettings',patch:Object.fromEntries(changes)});state.settings=result.settings;
  for(const [key,item]of items)if(drafts.get(key)===item)drafts.delete(key);render();if(changes.some(([key])=>key==='disabledSites'||key==='siteModes'))await refresh(true);return true;
 }catch(problem){for(const [key,item]of items)if(drafts.get(key)===item)drafts.delete(key);error('feedback','保存失敗：'+problem.message);render();return false;}
}
const saveField=(key,value)=>saveFields({[key]:value});
const port=chrome.runtime.connect({name:'video-control-popup'});
async function refresh(full=false,force=false){
 const request=++refreshRevision;
 try{
  const response=await send({action:full?'getState':'cachedState',refresh:force});if(closed||request!==refreshRevision)return;
  state=response;tabId=response.tabId;render();error('feedback');
  port.postMessage({action:'watch',tabId});
 }catch(problem){if(!closed&&request===refreshRevision){if(!state){const data=await chrome.storage.local.get('settings');state={settings:normalizeSettings(data.settings),target:null,pageUrl:''};}unavailable(problem.message);}}
}
port.onMessage.addListener(message=>{if(message.action==='updated'){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(),100);}});
const renew=setInterval(()=>{if(!state||!effective().enabled||disabledOnUrl(state.pageUrl,effective().disabledSites,effective().siteModes))return;try{port.postMessage({action:'renew'});}catch{}},3000);
window.addEventListener('pagehide',()=>{if(stepInputDirty&&state&&effective().enabled)commitSteps().catch(()=>{});closed=true;clearTimeout(rateTimer);clearTimeout(stepTimer);clearTimeout(refreshTimer);clearInterval(renew);try{port.disconnect();}catch{}});
async function flushRate(){
 clearTimeout(rateTimer);if(sendingRate||!pendingRate)return;
 const item=pendingRate;pendingRate=null;sendingRate=true;
 try{
  const response=await send({action:'command',command:'set',value:item.value,key:item.key});
  if(state.target?.key===item.key&&item.revision===rateRevision&&effective().enabled){Object.assign(state.target,response.result);if(item.revision===rateRevision&&!pendingRate&&!dragging){rateDirty=false;error('rate-error');}}
  if(response.result.rateStatus==='failed')throw Error(response.result.rateError);
 }catch(problem){error('rate-error',problem.message);}
 finally{sendingRate=false;if(pendingRate)flushRate();else render();}
}
function queueRate(value,immediate=true){
 if(!state?.target||!effective().enabled)return;
 if(!validRate(value)){error('rate-error','速度範圍：0.06–16×');return;}
 pendingRate={value:normalizeRate(value),key:state.target.key,revision:++rateRevision};$('current-rate').value=formatRate(value);rateDirty=true;error('rate-error');renderSlider();
 clearTimeout(rateTimer);if(immediate)flushRate();else rateTimer=setTimeout(flushRate,60);
}
$('enabled').addEventListener('click',async()=>{
 if(!state||powerBusy)return;powerBusy=true;const enabled=!effective().enabled;
 try{if(await saveField('enabled',enabled))await refresh(enabled);}finally{powerBusy=false;render();}
});
for(const button of document.querySelectorAll('[data-mode]'))button.addEventListener('click',()=>saveField('defaultMode',button.dataset.mode));
$('quality').addEventListener('click',()=>{$('quality-list').hidden?openQuality():closeQuality();});
$('quality').addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();openQuality();}});
$('quality-list').addEventListener('keydown',event=>{
 const options=[...$('quality-list').children],index=options.indexOf(document.activeElement);
 if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();focusQuality(options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length]);}
 if(event.key==='Escape'){event.preventDefault();closeQuality();$('quality').focus();}
});
function cancelRecording(){if(shortcutRecording){shortcutRecording='';renderShortcuts(effective());}}
document.addEventListener('click',event=>{if(!event.target.closest('.quality-picker'))closeQuality();if(!event.target.closest('.shortcut-row'))cancelRecording();});
document.addEventListener('focusin',event=>{if(!event.target.closest('.quality-picker'))closeQuality();if(!event.target.closest('.shortcut-row'))cancelRecording();});
window.addEventListener('resize',()=>{if(!$('quality-list').hidden)positionQuality();});
function settingsTab(name){
 cancelRecording();closeQuality();
 if(!$('panel-steps').hidden&&name!=='steps'&&stepInputDirty)commitSteps(true);
 const group=document.querySelector('[data-settings-tab="'+name+'"]').closest('[role=tablist]');
 for(const button of group.querySelectorAll('[data-settings-tab]')){const selected=button.dataset.settingsTab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('panel-'+button.dataset.settingsTab).hidden=!selected;}
 fitStepsInput();
 if(name==='sites'&&!siteInputDirty&&!$('site-input').value){const domain=siteDomain(state?.pageUrl);if(domain&&!effective().disabledSites.includes(domain))$('site-input').value=domain;}
}
for(const button of document.querySelectorAll('[data-settings-tab]')){
 button.addEventListener('click',()=>settingsTab(button.dataset.settingsTab));
 button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...button.closest('[role=tablist]').querySelectorAll('[data-settings-tab]')],index=buttons.indexOf(button),next=buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];settingsTab(next.dataset.settingsTab);next.focus();});
}
function showSettings(open){
 cancelRecording();closeQuality();if(!open&&stepInputDirty)commitSteps(true);
 $('home-view').hidden=open;$('settings-view').hidden=!open;
 if(open){settingsTab('interface');$('settings-back').focus();}else{sliderKey='';render();$('open-settings').focus();}
}
$('open-settings').addEventListener('click',()=>{if(state&&effective().enabled)showSettings(true);});
$('settings-back').addEventListener('click',()=>showSettings(false));
$('advanced').addEventListener('toggle',()=>{if(!$('advanced').open){cancelRecording();closeQuality();}});
$('site-add').addEventListener('click',()=>addSiteRule($('site-input').value));
$('site-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addSiteRule($('site-input').value);}});
$('site-input').addEventListener('input',()=>{siteInputDirty=true;error('site-error');});
async function commitSteps(showError=false){
 clearTimeout(stepTimer);if(!state||!effective().enabled)return;
 const raw=$('steps-input').value,request=++stepInputRevision;let steps;
 try{steps=validateSteps(raw);}catch(problem){if(showError)error('step-error',problem.message);return false;}
 error('step-error');const saved=await saveField('steps',steps);
 if(saved&&request===stepInputRevision&&$('steps-input').value===raw){stepInputDirty=false;if(document.activeElement!==$('steps-input'))$('steps-input').value=steps.map(formatRate).join(', ');fitStepsInput();}
 return saved;
}
$('steps-input').addEventListener('input',()=>{stepInputDirty=true;stepInputRevision++;clearTimeout(stepTimer);error('step-error');fitStepsInput();stepTimer=setTimeout(()=>commitSteps(),500);});
$('steps-input').addEventListener('blur',()=>commitSteps(true));
$('step-reset-request').addEventListener('click',()=>{$('step-reset-toolbar').hidden=false;});
$('step-reset-cancel').addEventListener('click',()=>{$('step-reset-toolbar').hidden=true;});
$('step-reset-confirm').addEventListener('click',async()=>{clearTimeout(stepTimer);const request=++stepInputRevision;if(await saveField('steps',[...DEFAULT_STEPS])&&request===stepInputRevision){stepInputDirty=false;$('steps-input').value=DEFAULT_STEPS.map(formatRate).join(', ');fitStepsInput();$('step-reset-toolbar').hidden=true;error('step-error');}});
async function saveShortcut(action,key){
 const shortcuts={...effective().shortcuts,[action]:key},duplicate=key&&shortcutActions.find(([other])=>other!==action&&shortcuts[other]===key);
 if(duplicate){error('shortcut-error','已用於「'+duplicate[1]+'」');return false;}
 shortcutRecording='';error('shortcut-error');return saveField('shortcuts',shortcuts);
}
window.addEventListener('keydown',event=>{
 if(!shortcutRecording||event.isComposing)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(event.key==='Escape'){cancelRecording();error('shortcut-error');return;}
 const key=shortcutFromEvent(event);if(key)saveShortcut(shortcutRecording,key);else if(!['Shift','Control','Alt','Meta','AltGraph'].includes(event.key))error('shortcut-error','請使用字元鍵或修飾鍵組合');
},true);
$('shortcut-reset-request').addEventListener('click',()=>{cancelRecording();$('shortcut-reset-toolbar').hidden=false;});
$('shortcut-reset-cancel').addEventListener('click',()=>{$('shortcut-reset-toolbar').hidden=true;});
$('shortcut-reset-confirm').addEventListener('click',async()=>{if(await saveField('shortcuts',{...DEFAULT_SHORTCUTS})){$('shortcut-reset-toolbar').hidden=true;error('shortcut-error');}});
for(const [id,key]of [['preferred-rate','preferredRate'],['custom-rate','customRate']]){
 $(id).addEventListener('input',()=>{if(validRate($(id).value))saveField(key,normalizeRate($(id).value));});
 $(id).addEventListener('change',()=>{if(validRate($(id).value))saveField(key,normalizeRate($(id).value));else error('feedback','速度範圍：0.06–16×');});
 $(id).addEventListener('blur',()=>render());
 $(id).addEventListener('keydown',event=>{if(event.key==='Enter')$(id).blur();});
}
$('refresh').addEventListener('click',()=>{rateDirty=false;refresh(true,true);});
$('pick').addEventListener('click',async()=>{try{await send({action:'pick',language});window.close();}catch(problem){error('feedback',problem.message);}});
for(const name of ['focus','click'])$('current-rate').addEventListener(name,event=>event.currentTarget.select());
$('current-rate').addEventListener('input',()=>{rateRevision++;rateDirty=true;error('rate-error');});
$('current-rate').addEventListener('change',()=>{if(!enterCommit)queueRate($('current-rate').value);});
$('current-rate').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();enterCommit=true;try{queueRate($('current-rate').value);$('current-rate').blur();}finally{enterCommit=false;}}if(event.key==='Escape'){rateRevision++;rateDirty=false;render();$('current-rate').blur();}});
for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',async()=>{
 const command=button.dataset.command;
 if(!state?.target||!effective().enabled)return;const key=state.target.key,request=++rateRevision;
 try{const result=await send({action:'command',command,key});if(state.target?.key===key&&request===rateRevision&&effective().enabled){Object.assign(state.target,result.result);if(request===rateRevision){rateDirty=false;error('rate-error');}render();}}catch(problem){error('rate-error',problem.message);}
});
$('rate-slider').addEventListener('pointerdown',()=>{dragging=true;});
$('rate-slider').addEventListener('input',()=>queueRate(rateAtPosition(Number($('rate-slider').value),effective().steps),false));
$('rate-slider').addEventListener('change',()=>{dragging=false;flushRate();});
$('rate-slider').addEventListener('pointercancel',()=>{dragging=false;flushRate();});
$('rate-slider').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(event.key)){event.preventDefault();$(event.key==='ArrowLeft'||event.key==='ArrowDown'?'slower':'faster').click();}else if(event.key==='Home'||event.key==='End'){event.preventDefault();queueRate(event.key==='Home'?effective().steps[0]:effective().steps.at(-1));}});
await refresh(true);
