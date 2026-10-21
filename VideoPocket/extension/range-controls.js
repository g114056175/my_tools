import {bindTimeInput, maskTimeDigits} from './time-input.js';

const MIN_STEP = 0.1;
const TIME_DIGITS = 1;

function quantizeTime(value, duration, preserveEndpoint = false) {
  const max = Math.max(0, Number(duration) || 0), number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (preserveEndpoint && number >= max) return max;
  return Math.max(0, Math.min(max, Math.round(number / MIN_STEP) / 10));
}

export function clampTime(value, duration) {
  const max = Number.isFinite(Number(duration)) && Number(duration) >= 0 ? Number(duration) : 0;
  return quantizeTime(value, max, true);
}

export function parseTime(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,2}:\d{2}:\d{2}(?:\.\d)?$/.test(text)) return null;
  const [hours, minutes, secondsText] = text.split(':');
  const seconds = Number(secondsText);
  if (!Number.isFinite(seconds) || Number(minutes) > 59 || seconds >= 60) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + seconds;
}

export function formatTime(value, precision = 'segment') {
  const total = Math.max(0, Number(value) || 0);
  const rounded = Math.round(total * 10) / 10;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded - hours * 3600 - minutes * 60;
  const whole = Math.floor(seconds);
  const fraction = Math.round((seconds - whole) * 10 ** TIME_DIGITS);
  const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}`;
  return fraction ? `${base}.${String(fraction).padStart(TIME_DIGITS, '0')}` : base;
}

const inputTime = value => {
  const text = formatTime(value);
  return maskTimeDigits(text.includes('.') ? text : `${text}.0`);
};

export function normalizeRange(start, end, duration, changed = '') {
  const max = Math.max(0, Number(duration) || 0);
  let a = quantizeTime(start, max), b = quantizeTime(end, max, true);
  const step = Math.min(MIN_STEP, max);
  if (step && b < a + step) {
    if (changed === 'start') a = Math.max(0, Math.round((b - step) / MIN_STEP) / 10);
    else if (changed === 'end') b = Math.min(max, Math.round((a + step) / MIN_STEP) / 10);
    else { b = Math.min(max, a + step); a = Math.max(0, b - step); }
  }
  return {start: a, end: b};
}

export function createRangeController(elements = {}, callbacks = {}) {
  const {details, start, end, length, startSlider, endSlider, timeline, message} = elements;
  let duration=0,supported=false,initialized=false,state={enabled:false,start:0,end:0};
  const set=(element,key,value)=>{if(element)element[key]=value;};
  const showMessage=text=>{set(message,'textContent',text);set(message,'hidden',!text);};
  const clearMessage=()=>{showMessage('');for(const element of [start,end]){element?.setCustomValidity?.('');element?.setAttribute?.('aria-invalid','false');}};
  const selection=()=>state.enabled&&supported&&(state.start>0.0005||state.end<duration-0.0005)?{start:state.start,end:state.end}:undefined;
  const render=()=>{
    state={...state,...normalizeRange(state.start,state.end,duration)};
    set(start,'value',inputTime(state.start));set(end,'value',inputTime(state.end));set(length,'value',formatTime(state.end-state.start));
    for(const [slider,value] of [[startSlider,state.start],[endSlider,state.end]]){set(slider,'max',String(duration));set(slider,'step','0.1');set(slider,'value',String(value));}
    for(const element of [start,end,startSlider,endSlider])set(element,'disabled',!supported);
    timeline?.style?.setProperty('--range-start',String(duration?state.start/duration*100:0)+'%');
    timeline?.style?.setProperty('--range-end',String(duration?state.end/duration*100:100)+'%');
    callbacks.onChange?.(selection(),{...state,duration,supported});
  };
  const update=(next={})=>{clearMessage();const changed=Object.keys(next).find(key=>key==='start'||key==='end')||'';state={...state,...next,...normalizeRange(next.start??state.start,next.end??state.end,duration,changed)};render();};
  const setCapability=value=>{
    clearMessage();const wasSupported=supported;
    const next=Number(value?.duration);duration=Number.isFinite(next)&&next>0?next:0;supported=value?.supported===true&&duration>0;
    if(!initialized){state={enabled:false,start:0,end:duration};initialized=!!value&&duration>0;}
    if(!supported){
      state={enabled:false,start:0,end:duration};
      if(details)details.open=false;
    }else if(!wasSupported){
      state={enabled:false,start:0,end:duration};
    }
    state.enabled=supported&&!!details?.open;
    if(details)details.title=supported?'':value?.reason||'此來源不支援區間下載';
    render();
  };
  const reset=()=>{clearMessage();supported=false;duration=0;initialized=false;state={enabled:false,start:0,end:0};if(details)details.open=false;render();};
  const onText=(which,element)=>{
    const value=parseTime(element?.value),valid=value!=null&&value<=duration;
    element?.setCustomValidity?.(''); // Use the inline status, never the native bubble.
    element?.setAttribute?.('aria-invalid',String(!valid));
    if(!valid){set(element,'value',inputTime(state[which]));showMessage(value==null?'時間格式不正確，已還原':'超過影片長度，已還原');return;}
    update({[which]:value});
    if(Math.abs(state[which]-value)>0.051)showMessage('已調整至有效區間');
  };
  details?.addEventListener?.('toggle',()=>update({enabled:supported&&!!details.open}));
  bindTimeInput(start,()=>onText('start',start),clearMessage);bindTimeInput(end,()=>onText('end',end),clearMessage);
  startSlider?.addEventListener?.('input',()=>update({start:Number(startSlider.value)}));endSlider?.addEventListener?.('input',()=>update({end:Number(endSlider.value)}));
  return {setCapability,reset,setEnabled:enabled=>{if(details)details.open=!!enabled;update({enabled:supported&&!!enabled});},setRange:range=>update(range||{}),getRange:selection,getState:()=>({...state,duration,supported}),render};
}
